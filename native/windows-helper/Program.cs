using System.Text.Json;
using System.Text.Json.Nodes;

namespace Jarvis.Automation;

/// <summary>
/// Entry point. Reads one JSON request per line, answers one JSON response per
/// line. The command set is closed: anything not in <see cref="Commands"/> is
/// refused. There is intentionally no command that runs a shell, PowerShell, a
/// script, arbitrary code or loads a DLL — not disabled, simply absent.
/// </summary>
public static class Program
{
    /// Same list as electron/desktop/protocol.ts. Two independent checks.
    private static readonly Dictionary<string, string[]> Commands = new()
    {
        ["ping"] = [], ["sessionState"] = [], ["monitors"] = [],
        ["listWindows"] = [], ["activeWindow"] = [],
        ["activateWindow"] = ["windowId"], ["setWindowState"] = ["windowId", "state"],
        ["moveWindow"] = ["windowId", "x", "y"], ["resizeWindow"] = ["windowId", "width", "height"],
        ["closeWindow"] = ["windowId"],
        ["uiRoot"] = ["windowId"], ["uiChildren"] = ["elementId"], ["uiElement"] = ["elementId"],
        ["uiFocus"] = ["elementId"], ["uiInvoke"] = ["elementId"], ["uiSetValue"] = ["elementId", "value"],
        ["uiToggle"] = ["elementId"], ["uiSelect"] = ["elementId"], ["uiExpand"] = ["elementId"],
        ["uiCollapse"] = ["elementId"], ["uiScroll"] = ["elementId", "direction", "amount"],
        ["cursor"] = [], ["inputState"] = [], ["mouseMove"] = ["x", "y"], ["mouseClick"] = ["x", "y", "button", "count"],
        ["mouseScroll"] = ["x", "y", "delta"], ["mouseDrag"] = ["fromX", "fromY", "toX", "toY", "durationMs"],
        ["keyPress"] = ["key"], ["keyHotkey"] = ["keys"], ["typeText"] = ["text"], ["cancelInput"] = [],
        ["captureDisplay"] = ["monitor"], ["captureWindow"] = ["windowId"],
        ["captureRegion"] = ["x", "y", "width", "height"], ["processes"] = [],
    };

    private static readonly object WriteLock = new();
    private static readonly Automation Ui = new();
    private static readonly Input Input = new(Emit);
    private static int InputBusy;

    [STAThread]
    public static int Main()
    {
        Console.InputEncoding = System.Text.Encoding.UTF8;
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Input.StartHumanInputHook();

        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            if (line.Length > 64 * 1024) { Reply(null, false, null, "Petición demasiado grande."); continue; }
            Handle(line);
        }
        Input.StopHumanInputHook();
        return 0;
    }

    private static void Handle(string line)
    {
        string? requestId = null;
        try
        {
            var node = JsonNode.Parse(line)?.AsObject() ?? throw new ArgumentException("Petición vacía.");
            requestId = node["requestId"]?.GetValue<string>();
            var command = node["command"]?.GetValue<string>() ?? throw new ArgumentException("Falta el comando.");
            var args = node["args"]?.AsObject() ?? new JsonObject();

            if (!Commands.TryGetValue(command, out var allowed))
                throw new ArgumentException($"Comando desconocido: {command}");
            foreach (var key in args.Select(kv => kv.Key))
                if (!allowed.Contains(key)) throw new ArgumentException($"Argumento no permitido: {key}");
            foreach (var key in allowed)
                if (!args.ContainsKey(key)) throw new ArgumentException($"Falta el argumento: {key}");

            // Nothing interactive happens on a locked or secure desktop.
            if (Session.IsInteractive(command) && Session.Current() != "ACTIVE")
                throw new InvalidOperationException("La sesión de Windows no está activa.");

            // Long SendInput actions must leave stdin free for cancelInput.
            // UIA stays on the STA main thread; only these two input commands
            // run on a worker, and other input is refused until they finish.
            if (command is "mouseDrag" or "typeText")
            {
                if (Interlocked.CompareExchange(ref InputBusy, 1, 0) != 0)
                    throw new InvalidOperationException("Ya hay una acción de entrada en curso.");
                Input.PrepareLongAction(command);
                var id = requestId;
                var worker = new Thread(() =>
                {
                    object? result = null; string? error = null;
                    try { result = Dispatch(command, args); }
                    catch (Exception ex) { error = ex.GetBaseException().Message; }
                    finally { Input.EndLongAction(); Interlocked.Exchange(ref InputBusy, 0); }
                    Reply(id, error is null, result, error);
                }) { IsBackground = true, Name = "cancellable-input" };
                worker.Start();
                return;
            }
            if (command is "mouseMove" or "mouseClick" or "mouseScroll" or "keyPress" or "keyHotkey")
                if (Volatile.Read(ref InputBusy) != 0)
                    throw new InvalidOperationException("Ya hay una acción de entrada en curso.");

            object? result = Dispatch(command, args);
            Reply(requestId, true, result, null);
        }
        catch (Exception ex)
        {
            Reply(requestId, false, null, ex.GetBaseException().Message);
        }
    }

    private static object? Dispatch(string command, JsonObject a) => command switch
    {
        "ping" => "pong",
        "sessionState" => Session.Current(),
        "monitors" => Windows.Monitors(),
        "listWindows" => Windows.List(),
        "activeWindow" => Windows.Active(),
        "activateWindow" => Do(() => Windows.Activate(S(a, "windowId"))),
        "setWindowState" => Do(() => Windows.SetState(S(a, "windowId"), S(a, "state"))),
        "moveWindow" => Do(() => Windows.Move(S(a, "windowId"), I(a, "x"), I(a, "y"))),
        "resizeWindow" => Do(() => Windows.Resize(S(a, "windowId"), I(a, "width"), I(a, "height"))),
        "closeWindow" => Do(() => Windows.RequestClose(S(a, "windowId"))),
        "uiRoot" => Ui.Root(S(a, "windowId")),
        "uiChildren" => Ui.Children(S(a, "elementId")),
        "uiElement" => Ui.Element(S(a, "elementId")),
        "uiFocus" => Do(() => Ui.Focus(S(a, "elementId"))),
        "uiInvoke" => Do(() => Ui.Invoke(S(a, "elementId"))),
        "uiSetValue" => Do(() => Ui.SetValue(S(a, "elementId"), S(a, "value"))),
        "uiToggle" => Do(() => Ui.Toggle(S(a, "elementId"))),
        "uiSelect" => Do(() => Ui.Select(S(a, "elementId"))),
        "uiExpand" => Do(() => Ui.Expand(S(a, "elementId"))),
        "uiCollapse" => Do(() => Ui.Collapse(S(a, "elementId"))),
        "uiScroll" => Do(() => Ui.Scroll(S(a, "elementId"), S(a, "direction"), I(a, "amount"))),
        "cursor" => Input.Cursor(),
        "inputState" => Input.State(),
        "mouseMove" => Do(() => Input.Move(I(a, "x"), I(a, "y"))),
        "mouseClick" => Do(() => Input.Click(I(a, "x"), I(a, "y"), S(a, "button"), I(a, "count"))),
        "mouseScroll" => Do(() => Input.Scroll(I(a, "x"), I(a, "y"), I(a, "delta"))),
        "mouseDrag" => Do(() => Input.Drag(I(a, "fromX"), I(a, "fromY"), I(a, "toX"), I(a, "toY"), I(a, "durationMs"))),
        "keyPress" => Do(() => Input.Press(S(a, "key"))),
        "keyHotkey" => Do(() => Input.Hotkey(a["keys"]!.AsArray().Select(k => k!.GetValue<string>()).ToArray())),
        "typeText" => Do(() => Input.Type(S(a, "text"))),
        "cancelInput" => Do(Input.Cancel),
        "captureDisplay" => Capture.Display(I(a, "monitor")),
        "captureWindow" => Capture.Window(S(a, "windowId")),
        "captureRegion" => Capture.Region(I(a, "x"), I(a, "y"), I(a, "width"), I(a, "height")),
        "processes" => Processes.List(),
        _ => throw new ArgumentException($"Comando desconocido: {command}"),
    };

    private static object? Do(Action action) { action(); return null; }
    private static string S(JsonObject a, string key) => a[key]?.GetValue<string>() ?? "";
    private static int I(JsonObject a, string key) => a[key]!.GetValue<int>();

    private static void Reply(string? requestId, bool ok, object? result, string? error)
    {
        var payload = new Dictionary<string, object?> { ["requestId"] = requestId ?? "", ["ok"] = ok };
        if (result != null) payload["result"] = result;
        if (error != null) payload["error"] = error;
        Write(JsonSerializer.Serialize(payload));
    }

    /// Unsolicited events: human input and session changes.
    public static void Emit(string evt, object data) =>
        Write(JsonSerializer.Serialize(new Dictionary<string, object> { ["event"] = evt, ["data"] = data }));

    private static void Write(string json)
    {
        lock (WriteLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }
}
