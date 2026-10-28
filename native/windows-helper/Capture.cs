using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

namespace Jarvis.Automation;

/// Captures to memory and returns base64 PNG. Nothing is written to disk.
internal static class Capture
{
    public static object Display(int monitor)
    {
        var screens = Screen.AllScreens;
        if (monitor < 0 || monitor >= screens.Length) throw new ArgumentException("Monitor inexistente.");
        var b = screens[monitor].Bounds;
        return Grab(b.X, b.Y, b.Width, b.Height);
    }

    public static object Window(string windowId)
    {
        Native.GetWindowRect(Native.ParseHwnd(windowId), out var r);
        return Grab(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
    }

    public static object Region(int x, int y, int w, int h) => Grab(x, y, w, h);

    private static object Grab(int x, int y, int w, int h)
    {
        if (w <= 0 || h <= 0 || w > 16384 || h > 16384) throw new ArgumentException("Región inválida.");
        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
        using var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Png);
        return new { width = w, height = h, data = Convert.ToBase64String(ms.ToArray()) };
    }
}
