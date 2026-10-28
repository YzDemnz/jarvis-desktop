using System.Runtime.InteropServices;

namespace Jarvis.Automation;

/// SendInput for synthesis, low-level hooks for human-override detection.
/// Every synthetic event carries the INJECTED flag, which is how the hook
/// tells JARVIS's input from the user's — the basis of "no fight over the cursor".
internal sealed class Input
{
    private readonly Action<string, object> emit;
    private volatile bool cancelled;
    private readonly object inputLock = new();
    private readonly ManualResetEventSlim stopEvent = new(false);
    private long sequence;
    private string action = "idle";
    private int injectedSteps, injectedCharacters;
    private int? lastX, lastY;
    private bool active;
    private IntPtr mouseHook = IntPtr.Zero, keyHook = IntPtr.Zero;
    private Native.LowLevelProc? mouseProc, keyProc;
    private Thread? hookThread;
    private long lastHumanEmit;

    public Input(Action<string, object> emit) { this.emit = emit; }

    public object Cursor() { Native.GetCursorPos(out var p); return new { x = p.X, y = p.Y }; }

    public void Cancel() { lock (inputLock) { cancelled = true; stopEvent.Set(); } }
    private void Begin() { lock (inputLock) { cancelled = false; stopEvent.Reset(); } }
    public void PrepareLongAction(string name) { lock (inputLock) { Begin(); sequence++; action = name; active = true; injectedSteps = injectedCharacters = 0; lastX = lastY = null; } }
    public void EndLongAction() { lock (inputLock) active = false; }
    // Counts and coordinates only; typed text and secrets never enter diagnostics.
    public object State() { lock (inputLock) return new { sequence, action, active, cancelled, injectedSteps, injectedCharacters, lastInjected = lastX.HasValue ? new { x = lastX.Value, y = lastY!.Value } : null }; }
    private void Check() { if (cancelled) throw new OperationCanceledException("Acción de entrada cancelada."); }

    public void Move(int x, int y) { Begin(); MoveInjected(x, y); }
    private void MoveInjected(int x, int y)
    {
        lock (inputLock)
        {
            Check();
            int left = Native.GetSystemMetrics(76), top = Native.GetSystemMetrics(77), width = Native.GetSystemMetrics(78), height = Native.GetSystemMetrics(79);
            if (width < 2 || height < 2 || x < left || y < top || x >= left + width || y >= top + height) throw new ArgumentException("Coordenadas fuera del escritorio virtual.");
            var input = Mouse(0x8000 | 0x4000 | 1); // ABSOLUTE | VIRTUALDESK | MOVE: marked injected by Windows
            input.u.mi.dx = (int)Math.Round((x - left) * 65535.0 / (width - 1));
            input.u.mi.dy = (int)Math.Round((y - top) * 65535.0 / (height - 1));
            Send(input); lastX = x; lastY = y; injectedSteps++;
        }
    }

    public void Click(int x, int y, string button, int count)
    {
        Begin();
        MoveInjected(x, y);
        var (down, up) = button switch
        {
            "right" => (Native.MOUSEEVENTF_RIGHTDOWN, Native.MOUSEEVENTF_RIGHTUP),
            "middle" => (Native.MOUSEEVENTF_MIDDLEDOWN, Native.MOUSEEVENTF_MIDDLEUP),
            _ => (Native.MOUSEEVENTF_LEFTDOWN, Native.MOUSEEVENTF_LEFTUP),
        };
        for (int i = 0; i < Math.Clamp(count, 1, 2); i++)
        {
            Check();
            Send(Mouse(down)); Send(Mouse(up));
        }
    }

    public void Scroll(int x, int y, int delta)
    {
        Begin();
        MoveInjected(x, y);
        var m = Mouse(Native.MOUSEEVENTF_WHEEL);
        m.u.mi.mouseData = unchecked((uint)(Math.Clamp(delta, -20, 20) * 120));
        Send(m);
    }

    /// Interpolated in small steps, checking for cancellation between each.
    public void Drag(int fx, int fy, int tx, int ty, int durationMs)
    {
        Check();
        MoveInjected(fx, fy);
        lock (inputLock) { Check(); Send(Mouse(Native.MOUSEEVENTF_LEFTDOWN)); }
        try
        {
            int steps = Math.Clamp(durationMs / 16, 5, 300);
            for (int i = 1; i <= steps; i++)
            {
                Check();
                MoveInjected(fx + (tx - fx) * i / steps, fy + (ty - fy) * i / steps);
                stopEvent.Wait(Math.Max(1, durationMs / steps));
            }
        }
        finally { Send(Mouse(Native.MOUSEEVENTF_LEFTUP)); } // never leave the button held
    }

    public void Press(string key) { Begin(); var vk = Vk(key); Send(Key(vk, false)); Send(Key(vk, true)); }

    public void Hotkey(string[] keys)
    {
        Begin();
        var vks = keys.Select(Vk).ToArray();
        foreach (var vk in vks) Send(Key(vk, false));
        foreach (var vk in vks.Reverse()) Send(Key(vk, true));
    }

    /// Unicode injection, a few characters at a time, cancellable between chunks.
    public void Type(string text)
    {
        Check();
        foreach (var ch in text)
        {
            Check();
            lock (inputLock) { Check(); Send(Unicode(ch, false)); Send(Unicode(ch, true)); injectedCharacters++; }
            stopEvent.Wait(4);
        }
    }

    private static ushort Vk(string key) => key.ToLowerInvariant() switch
    {
        "enter" or "return" => 0x0D, "tab" => 0x09, "escape" or "esc" => 0x1B, "space" => 0x20,
        "backspace" => 0x08, "delete" or "del" => 0x2E, "home" => 0x24, "end" => 0x23,
        "pageup" => 0x21, "pagedown" => 0x22, "up" => 0x26, "down" => 0x28, "left" => 0x25, "right" => 0x27,
        "insert" => 0x2D, "ctrl" or "control" => 0x11, "alt" => 0x12, "shift" => 0x10, "win" or "meta" => 0x5B,
        var f when f.StartsWith('f') && int.TryParse(f[1..], out var n) && n is >= 1 and <= 12 => (ushort)(0x6F + n),
        var c when c.Length == 1 => (ushort)(Native.VkKeyScan(c[0]) & 0xFF),
        _ => throw new ArgumentException($"Tecla desconocida: {key}"),
    };

    private static Native.INPUT Mouse(uint flags) => new() { type = Native.INPUT_MOUSE, u = new() { mi = new() { dwFlags = flags } } };
    private static Native.INPUT Key(ushort vk, bool up) => new() { type = Native.INPUT_KEYBOARD, u = new() { ki = new() { wVk = vk, dwFlags = up ? Native.KEYEVENTF_KEYUP : 0 } } };
    private static Native.INPUT Unicode(char ch, bool up) => new() { type = Native.INPUT_KEYBOARD, u = new() { ki = new() { wScan = ch, dwFlags = Native.KEYEVENTF_UNICODE | (up ? Native.KEYEVENTF_KEYUP : 0) } } };

    private static void Send(Native.INPUT input)
    {
        if (Native.SendInput(1, [input], Marshal.SizeOf<Native.INPUT>()) != 1)
            throw new InvalidOperationException("Windows rechazó la entrada sintética (UIPI o escritorio seguro).");
    }

    /* ---------------- human override ---------------- */

    public void StartHumanInputHook()
    {
        hookThread = new Thread(() =>
        {
            var module = Native.GetModuleHandle(null);
            mouseProc = (n, w, l) =>
            {
                if (n >= 0)
                {
                    var data = Marshal.PtrToStructure<Native.MSLLHOOKSTRUCT>(l);
                    if ((data.flags & Native.LLMHF_INJECTED) == 0) Human("mouse");
                }
                return Native.CallNextHookEx(mouseHook, n, w, l);
            };
            keyProc = (n, w, l) =>
            {
                if (n >= 0)
                {
                    var data = Marshal.PtrToStructure<Native.KBDLLHOOKSTRUCT>(l);
                    if ((data.flags & Native.LLKHF_INJECTED) == 0) Human("keyboard");
                }
                return Native.CallNextHookEx(keyHook, n, w, l);
            };
            mouseHook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, mouseProc, module, 0);
            keyHook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, keyProc, module, 0);
            System.Windows.Forms.Application.Run(); // message loop for the hooks
        }) { IsBackground = true, Name = "human-input-hook" };
        hookThread.SetApartmentState(ApartmentState.STA);
        hookThread.Start();
    }

    /// Throttled: one event per 150 ms is plenty to trigger a pause.
    private void Human(string kind)
    {
        var now = Environment.TickCount64;
        if (now - Interlocked.Read(ref lastHumanEmit) < 150) return;
        Interlocked.Exchange(ref lastHumanEmit, now);
        emit("humanInput", new { kind, at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
    }

    public void StopHumanInputHook()
    {
        if (mouseHook != IntPtr.Zero) Native.UnhookWindowsHookEx(mouseHook);
        if (keyHook != IntPtr.Zero) Native.UnhookWindowsHookEx(keyHook);
    }
}
