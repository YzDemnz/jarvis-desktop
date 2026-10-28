using System;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var window = new Form
        {
            Text = "JARVIS Native Test Fixture",
            Width = 760,
            Height = 520,
            StartPosition = FormStartPosition.CenterScreen,
        };
        window.Controls.Add(new TextBox
        {
            Name = "JarvisTestEditor",
            AccessibleName = "JARVIS Test Editor",
            Multiline = true,
            Dock = DockStyle.Fill,
            Text = "Prueba JARVIS Windows: áéíóú ñ",
        });
        var actions = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 56 };
        actions.Controls.Add(new Label { Text = "JARVIS fixture", Width = 120 });
        actions.Controls.Add(new Button { Text = "Uno", Width = 80 });
        actions.Controls.Add(new Button { Text = "Dos", Width = 80 });
        actions.Controls.Add(new Button { Text = "Tres", Width = 80 });
        window.Controls.Add(actions);
        Application.Run(window);
    }
}
