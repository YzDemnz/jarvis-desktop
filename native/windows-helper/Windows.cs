using System.Diagnostics;
using System.Text;
using System.Windows.Forms;

namespace Jarvis.Automation;

internal static class Windows
{
    public static List<object> Monitors() =>
        Screen.AllScreens.Select((s, i) => (object)new
        {
            id = $"mon-{i}", index = i, primary = s.Primary, scaleFactor = ScaleFactor(s),
            bounds = new { x = s.Bounds.X, y = s.Bounds.Y, width = s.Bounds.Width, height = s.Bounds.Height },
            workArea = new { x = s.WorkingArea.X, y = s.WorkingArea.Y, width = s.WorkingArea.Width, height = s.WorkingArea.Height },
        }).ToList();

    private static double ScaleFactor(Screen screen)
    {
        var center = new Native.POINT
        {
            X = screen.Bounds.X + screen.Bounds.Width / 2,
            Y = screen.Bounds.Y + screen.Bounds.Height / 2,
        };
        var monitor = Native.MonitorFromPoint(center, 2); // nearest monitor
        if (monitor == IntPtr.Zero || Native.GetDpiForMonitor(monitor, 0, out var dpiX, out _) != 0)
            return 1.0;
        return dpiX / 96.0;
    }

    public static List<object> List()
    {
        var result = new List<object>();
        var foreground = Native.GetForegroundWindow();
        Native.EnumWindows((h, _) =>
        {
            // Top-level, visible, titled, not owned: what a user calls "a window".
            if (!Native.IsWindowVisible(h) || Native.GetWindow(h, Native.GW_OWNER) != IntPtr.Zero) return true;
            if (Native.GetWindowTextLength(h) == 0) return true;
            result.Add(Describe(h, foreground));
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static object? Active()
    {
        var h = Native.GetForegroundWindow();
        return h == IntPtr.Zero ? null : Describe(h, h);
    }

    private static object Describe(IntPtr h, IntPtr foreground)
    {
        var title = new StringBuilder(Native.GetWindowTextLength(h) + 1);
        Native.GetWindowText(h, title, title.Capacity);
        Native.GetWindowThreadProcessId(h, out var pid);
        Native.GetWindowRect(h, out var r);
        string processName = "";
        bool elevated = false;
        try
        {
            using var p = Process.GetProcessById((int)pid);
            processName = p.ProcessName + ".exe";
            // Reading MainModule of an elevated process from a non-elevated one
            // throws: that is exactly the signal we want.
            _ = p.MainModule;
        }
        catch (System.ComponentModel.Win32Exception) { elevated = true; }
        catch { }

        var screen = Screen.FromHandle(h);
        return new
        {
            windowId = Native.HwndId(h), processId = (int)pid, processName, title = title.ToString(),
            bounds = new { x = r.Left, y = r.Top, width = r.Right - r.Left, height = r.Bottom - r.Top },
            state = Native.IsIconic(h) ? "minimized" : Native.IsZoomed(h) ? "maximized" : "normal",
            visible = true, focused = h == foreground,
            monitor = Array.IndexOf(Screen.AllScreens, screen), elevated,
        };
    }

    public static void Activate(string id)
    {
        var h = Native.ParseHwnd(id);
        if (Native.IsIconic(h)) Native.ShowWindow(h, Native.SW_RESTORE);
        if (!Native.SetForegroundWindow(h)) throw new InvalidOperationException("Windows no permitió traer la ventana al frente.");
    }

    public static void SetState(string id, string state)
    {
        var h = Native.ParseHwnd(id);
        Native.ShowWindow(h, state switch { "minimized" => Native.SW_MINIMIZE, "maximized" => Native.SW_MAXIMIZE, _ => Native.SW_RESTORE });
    }

    public static void Move(string id, int x, int y) =>
        Native.SetWindowPos(Native.ParseHwnd(id), IntPtr.Zero, x, y, 0, 0, Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);

    public static void Resize(string id, int w, int h) =>
        Native.SetWindowPos(Native.ParseHwnd(id), IntPtr.Zero, 0, 0, w, h, Native.SWP_NOMOVE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);

    /// WM_CLOSE, never a kill: the app gets to ask about unsaved work, and the
    /// helper has no command that could answer that dialog on the user's behalf.
    public static void RequestClose(string id) => Native.PostMessage(Native.ParseHwnd(id), Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
}

internal static class Processes
{
    public static List<object> List() =>
        Process.GetProcesses().Select(p =>
        {
            long? mem = null;
            try { mem = p.WorkingSet64; } catch { }
            return (object)new { pid = p.Id, name = p.ProcessName + ".exe", memoryBytes = mem, windowCount = p.MainWindowHandle != IntPtr.Zero ? 1 : 0, elevated = (bool?)null };
        }).ToList();
}
