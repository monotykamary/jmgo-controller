package com.jmgo.middleware.service;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final int TEXT_PRIMARY = Color.rgb(245, 245, 245);
    private static final int TEXT_SECONDARY = Color.rgb(185, 190, 200);
    private static final int TEXT_SUCCESS = Color.rgb(130, 220, 155);
    private static final int TEXT_ERROR = Color.rgb(255, 140, 140);

    private Button applyButton;
    private CheckBox bootRepair;
    private TextView status;
    private volatile boolean applying;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(buildContent());
        refreshStatus();
        applyButton.requestFocus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!applying) refreshStatus();
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (!applying) refreshStatus();
    }

    private View buildContent() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        int horizontal = dp(54);
        int vertical = dp(28);
        content.setPadding(horizontal, vertical, horizontal, vertical);
        scroll.addView(content, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        TextView heading = text("JMGO Native English", 30, TEXT_PRIMARY);
        heading.setGravity(Gravity.CENTER);
        content.addView(heading, matchWrap());

        TextView explanation = text(
            "Applies Android's native English locale and repairs JMGO Settings without drawing over the screen.",
            18,
            TEXT_PRIMARY
        );
        explanation.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams explanationParams = matchWrap();
        explanationParams.topMargin = dp(12);
        content.addView(explanation, explanationParams);

        TextView coverage = text(
            "The pinned firmware contains 1,979 native English default strings across the audited packages. This repair specifically recovers 1,271 Settings strings hidden by JMGO locale handling. Chinese-only resources remain unchanged.",
            15,
            TEXT_SECONDARY
        );
        coverage.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams coverageParams = matchWrap();
        coverageParams.topMargin = dp(8);
        content.addView(coverage, coverageParams);

        bootRepair = new CheckBox(this);
        bootRepair.setText("Repair native English after startup");
        bootRepair.setTextColor(TEXT_PRIMARY);
        bootRepair.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        bootRepair.setChecked(LocaleRepair.isBootRepairEnabled(this));
        bootRepair.setOnCheckedChangeListener((button, checked) ->
            LocaleRepair.setBootRepairEnabled(MainActivity.this, checked)
        );
        LinearLayout.LayoutParams bootParams = wrapWrap();
        bootParams.topMargin = dp(18);
        content.addView(bootRepair, bootParams);

        applyButton = new Button(this);
        applyButton.setText("Apply Native English");
        applyButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        applyButton.setOnClickListener(view -> beginRepair());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(dp(310), dp(58));
        buttonParams.topMargin = dp(12);
        content.addView(applyButton, buttonParams);

        status = text("", 15, TEXT_SECONDARY);
        status.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusParams = matchWrap();
        statusParams.topMargin = dp(14);
        content.addView(status, statusParams);
        return scroll;
    }

    private void beginRepair() {
        if (applying) return;
        if (!LocaleRepair.hasConfigurationPermission(this)) {
            showError(
                "Configuration permission is missing. Run the host installer or grant over ADB:\n"
                    + "pm grant " + getPackageName() + " android.permission.CHANGE_CONFIGURATION"
            );
            return;
        }

        applying = true;
        applyButton.setEnabled(false);
        bootRepair.setEnabled(false);
        status.setTextColor(TEXT_SECONDARY);
        status.setText("Applying en-GB -> en while safely refreshing JMGO Settings...");

        new Thread(() -> {
            try {
                LocaleRepair.Result result = LocaleRepair.applyNativeEnglish(MainActivity.this);
                rememberResult(result.summary());
                runOnUiThread(() -> {
                    status.setTextColor(TEXT_SUCCESS);
                    status.setText(result.summary());
                });
            } catch (Exception error) {
                String message = LocaleRepair.describe(error);
                rememberResult("Repair failed: " + message);
                runOnUiThread(() -> showError("Repair failed: " + message));
            } finally {
                applying = false;
                runOnUiThread(() -> {
                    applyButton.setEnabled(LocaleRepair.hasConfigurationPermission(MainActivity.this));
                    bootRepair.setEnabled(true);
                });
            }
        }, "jmgo-native-english").start();
    }

    private void refreshStatus() {
        boolean permission = LocaleRepair.hasConfigurationPermission(this);
        applyButton.setEnabled(permission);
        String locale;
        try {
            locale = LocaleRepair.primaryLocaleTag();
        } catch (Exception error) {
            locale = "unknown";
        }
        String previous = getSharedPreferences(LocaleRepair.PREFERENCES, MODE_PRIVATE)
            .getString(LocaleRepair.LAST_RESULT, "No repair has run yet.");
        status.setTextColor(permission ? TEXT_SECONDARY : TEXT_ERROR);
        status.setText(
            "System locale: " + locale + "\n"
                + "Configuration permission: " + (permission ? "granted" : "missing") + "\n"
                + previous
        );
    }

    private void rememberResult(String value) {
        getSharedPreferences(LocaleRepair.PREFERENCES, MODE_PRIVATE)
            .edit()
            .putString(LocaleRepair.LAST_RESULT, value)
            .putLong(LocaleRepair.LAST_RESULT_TIME, System.currentTimeMillis())
            .apply();
    }

    private void showError(String message) {
        status.setTextColor(TEXT_ERROR);
        status.setText(message);
    }

    private TextView text(String value, int sizeSp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        view.setTextColor(color);
        view.setLineSpacing(0f, 1.12f);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    private LinearLayout.LayoutParams wrapWrap() {
        return new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
