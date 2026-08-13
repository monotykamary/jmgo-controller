package works.earendil.jmgo.english.patch;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.15f);
        return view;
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        layout.setPadding(dp(this, 72), dp(this, 48), dp(this, 72), dp(this, 48));
        layout.setBackgroundColor(Color.rgb(16, 16, 16));

        TextView title = text("JMGO English Patch", 30, Color.WHITE);
        layout.addView(title, new LinearLayout.LayoutParams(-1, -2));

        TextView body = text("Enable the accessibility service to draw English labels over known untranslated JMGO text in Settings, Launcher, Setup Guide, and System UI.", 18, Color.LTGRAY);
        LinearLayout.LayoutParams bodyParams = new LinearLayout.LayoutParams(-1, -2);
        bodyParams.topMargin = dp(this, 24);
        layout.addView(body, bodyParams);

        TextView privacy = text("This service only traverses visible text when one of the four supported JMGO packages is active. It does not click, type, collect, store, or transmit anything.", 15, Color.GRAY);
        LinearLayout.LayoutParams privacyParams = new LinearLayout.LayoutParams(-1, -2);
        privacyParams.topMargin = dp(this, 20);
        layout.addView(privacy, privacyParams);

        Button open = new Button(this);
        open.setText("Open Accessibility settings");
        open.setTextSize(18);
        open.setFocusable(true);
        open.setOnClickListener((View ignored) -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-2, dp(this, 64));
        buttonParams.topMargin = dp(this, 36);
        layout.addView(open, buttonParams);

        setContentView(layout);
        open.requestFocus();
    }
}
