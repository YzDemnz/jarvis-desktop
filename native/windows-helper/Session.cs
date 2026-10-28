using System.Text;

namespace Jarvis.Automation;

/// Tells ACTIVE from LOCKED from the secure desktop, so the helper refuses to
/// interact whenever the input desktop is not the user's normal one.
internal static class Session
{
    private static readonly HashSet<string> Interactive =
    [
        "activateWindow", "setWindowState", "moveWindow", "resizeWindow", "closeWindow",
        "uiFocus", "uiInvoke", "uiSetValue", "uiToggle", "uiSelect", "uiExpand", "uiCollapse", "uiScroll",
        "mouseMove", "mouseClick", "mouseScroll", "mouseDrag", "keyPress", "keyHotkey", "typeText",
    ];

    public static bool IsInteractive(string command) => Interactive.Contains(command);

    public static string Current()
    {
        // When the workstation is locked or UAC is up, the input desktop is
        // "Winlogon" (or cannot be opened at all from a normal process).
        const uint DESKTOP_READOBJECTS = 0x0001;
        var desk = Native.OpenInputDesktop(0, false, DESKTOP_READOBJECTS);
        if (desk == IntPtr.Zero) return "LOCKED";
        try
        {
            var name = new StringBuilder(256);
            if (!Native.GetUserObjectInformation(desk, 2 /* UOI_NAME */, name, name.Capacity * 2, out _)) return "UNKNOWN";
            var n = name.ToString();
            if (n.Equals("Default", StringComparison.OrdinalIgnoreCase)) return "ACTIVE";
            if (n.Equals("Winlogon", StringComparison.OrdinalIgnoreCase)) return "SECURE_DESKTOP";
            return "UNKNOWN";
        }
        finally { Native.CloseDesktop(desk); }
    }
}
