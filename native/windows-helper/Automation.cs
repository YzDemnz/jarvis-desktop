using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using System.Windows.Automation;

namespace Jarvis.Automation;

/// UI Automation over System.Windows.Automation. Elements are cached by a
/// short opaque id; the runtime id from UIA never leaves the helper.
internal sealed class Automation
{
    private readonly ConcurrentDictionary<string, AutomationElement> cache = new();
    private int next = 1;

    private static readonly Regex Secret = new(
        // Mirrors SENSITIVE_FIELD_NAMES in src/machine/CredentialBoundary.ts.
        @"(pass(word|phrase)?|pwd|pin|otp|mfa|2fa|totp|one[-_ ]?time|verification[-_ ]?code|security[-_ ]?code|recovery[-_ ]?code|backup[-_ ]?code|cvv|cvc|secret|token|credential|contrase(ñ|n)a|(?<!palabra[\s_-])clave|\bnip\b|c(ó|o)digo[\s_-]*de[\s_-]*(verificaci|seguridad|recuperaci|respaldo|acceso|un[\s_-]*solo[\s_-]*uso)|credencial)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private string Remember(AutomationElement el)
    {
        var id = $"el:{Interlocked.Increment(ref next)}";
        cache[id] = el;
        return id;
    }

    private AutomationElement Get(string id) =>
        cache.TryGetValue(id, out var el) ? el : throw new InvalidOperationException($"Elemento inexistente o ya no disponible: {id}");

    public object Root(string windowId) => Describe(AutomationElement.FromHandle(Native.ParseHwnd(windowId)), windowId, null);

    public List<object> Children(string elementId)
    {
        var parent = Get(elementId);
        var windowId = WindowOf(parent);
        var list = new List<object>();
        var walker = TreeWalker.ControlViewWalker;
        var child = walker.GetFirstChild(parent);
        int guard = 0;
        while (child != null && guard++ < 500)
        {
            list.Add(Describe(child, windowId, elementId));
            child = walker.GetNextSibling(child);
        }
        return list;
    }

    public object? Element(string elementId)
    {
        if (!cache.TryGetValue(elementId, out var el)) return null;
        try { _ = el.Current.Name; } catch (ElementNotAvailableException) { cache.TryRemove(elementId, out _); return null; }
        return Describe(el, WindowOf(el), null, elementId);
    }

    private static string WindowOf(AutomationElement el)
    {
        var walker = TreeWalker.ControlViewWalker;
        var cur = el;
        while (cur != null)
        {
            var h = cur.Current.NativeWindowHandle;
            var parent = walker.GetParent(cur);
            if (h != 0 && (parent == null || parent == AutomationElement.RootElement)) return Native.HwndId(new IntPtr(h));
            cur = parent;
        }
        return "hwnd:0x0";
    }

    private object Describe(AutomationElement el, string windowId, string? parentId, string? knownId = null)
    {
        var c = el.Current;
        var id = knownId ?? Remember(el);
        var patterns = new List<string>();
        object? pattern;
        if (el.TryGetCurrentPattern(InvokePattern.Pattern, out _)) patterns.Add("Invoke");
        if (el.TryGetCurrentPattern(ValuePattern.Pattern, out _)) patterns.Add("Value");
        if (el.TryGetCurrentPattern(SelectionPattern.Pattern, out _)) patterns.Add("Selection");
        if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _)) patterns.Add("SelectionItem");
        if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out _)) patterns.Add("ExpandCollapse");
        if (el.TryGetCurrentPattern(TogglePattern.Pattern, out _)) patterns.Add("Toggle");
        if (el.TryGetCurrentPattern(ScrollPattern.Pattern, out _)) patterns.Add("Scroll");
        if (el.TryGetCurrentPattern(RangeValuePattern.Pattern, out _)) patterns.Add("RangeValue");
        if (el.TryGetCurrentPattern(WindowPattern.Pattern, out _)) patterns.Add("Window");

        // The credential boundary starts here, in the helper: a secret field's
        // value is never read into the process's output at all.
        bool secret = c.IsPassword || Secret.IsMatch(c.Name ?? "") || Secret.IsMatch(c.AutomationId ?? "");
        string? value = null;
        bool? filled = null;
        if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
        {
            var raw = ((ValuePattern)pattern).Current.Value ?? "";
            if (secret) filled = raw.Length > 0; else value = raw.Length > 2000 ? raw[..2000] : raw;
        }

        string? toggle = null;
        if (el.TryGetCurrentPattern(TogglePattern.Pattern, out pattern))
            toggle = ((TogglePattern)pattern).Current.ToggleState switch { ToggleState.On => "on", ToggleState.Off => "off", _ => "indeterminate" };
        string? expand = null;
        if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
            expand = ((ExpandCollapsePattern)pattern).Current.ExpandCollapseState switch
            { ExpandCollapseState.Expanded => "expanded", ExpandCollapseState.LeafNode => "leaf", _ => "collapsed" };

        var r = c.BoundingRectangle;
        var walker = TreeWalker.ControlViewWalker;
        // The TypeScript inspector only needs to know whether to descend.
        // Counting every sibling for every node made large Electron trees
        // exceed the bridge's five-second UIA request timeout on Windows.
        int childCount = walker.GetFirstChild(el) is null ? 0 : 1;

        return new
        {
            id, windowId, parentId,
            name = c.Name ?? "", automationId = c.AutomationId ?? "",
            controlType = c.ControlType.ProgrammaticName.Replace("ControlType.", ""),
            className = c.ClassName ?? "",
            bounds = r.IsEmpty ? null : new { x = (int)r.X, y = (int)r.Y, width = (int)r.Width, height = (int)r.Height },
            enabled = c.IsEnabled, visible = !c.IsOffscreen, focusable = c.IsKeyboardFocusable, focused = c.HasKeyboardFocus,
            patterns, value, filled, secret, toggleState = toggle, expandState = expand, childCount,
        };
    }

    private static T Pattern<T>(AutomationElement el, AutomationPattern p, string name) where T : BasePattern =>
        el.TryGetCurrentPattern(p, out var obj) ? (T)obj : throw new InvalidOperationException($"El control no expone el patrón {name}.");

    public void Focus(string id) => Get(id).SetFocus();
    public void Invoke(string id) => Pattern<InvokePattern>(Get(id), InvokePattern.Pattern, "Invoke").Invoke();
    public void Toggle(string id) => Pattern<TogglePattern>(Get(id), TogglePattern.Pattern, "Toggle").Toggle();
    public void Select(string id) => Pattern<SelectionItemPattern>(Get(id), SelectionItemPattern.Pattern, "SelectionItem").Select();
    public void Expand(string id) => Pattern<ExpandCollapsePattern>(Get(id), ExpandCollapsePattern.Pattern, "ExpandCollapse").Expand();
    public void Collapse(string id) => Pattern<ExpandCollapsePattern>(Get(id), ExpandCollapsePattern.Pattern, "ExpandCollapse").Collapse();

    public void SetValue(string id, string value)
    {
        var el = Get(id);
        var c = el.Current;
        // Second, independent refusal: even if the caller slipped, the helper
        // itself will not write into a credential field.
        if (c.IsPassword || Secret.IsMatch(c.Name ?? "") || Secret.IsMatch(c.AutomationId ?? ""))
            throw new InvalidOperationException("Campo de credenciales: el usuario debe escribirlo.");
        Pattern<ValuePattern>(el, ValuePattern.Pattern, "Value").SetValue(value);
    }

    public void Scroll(string id, string direction, int amount)
    {
        var sp = Pattern<ScrollPattern>(Get(id), ScrollPattern.Pattern, "Scroll");
        var step = amount > 3 ? ScrollAmount.LargeIncrement : ScrollAmount.SmallIncrement;
        var back = amount > 3 ? ScrollAmount.LargeDecrement : ScrollAmount.SmallDecrement;
        switch (direction)
        {
            case "down": sp.ScrollVertical(step); break;
            case "up": sp.ScrollVertical(back); break;
            case "right": sp.ScrollHorizontal(step); break;
            case "left": sp.ScrollHorizontal(back); break;
        }
    }
}
