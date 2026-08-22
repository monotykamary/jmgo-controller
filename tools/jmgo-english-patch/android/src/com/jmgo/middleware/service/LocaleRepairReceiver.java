package com.jmgo.middleware.service;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public final class LocaleRepairReceiver extends BroadcastReceiver {
    public static final String ACTION_APPLY =
        "com.jmgo.middleware.service.APPLY_NATIVE_ENGLISH";
    private static final String TAG = "JmgoNativeEnglish";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        boolean requested = ACTION_APPLY.equals(action);
        boolean boot = Intent.ACTION_BOOT_COMPLETED.equals(action);
        if (!requested && !boot) return;
        if (boot && !LocaleRepair.isBootRepairEnabled(context)) return;

        boolean ordered = isOrderedBroadcast();
        PendingResult pending = goAsync();
        Context application = context.getApplicationContext();
        new Thread(() -> {
            try {
                LocaleRepair.Result result = LocaleRepair.applyNativeEnglish(application);
                saveResult(application, result.summary());
                Log.i(TAG, result.summary());
                if (ordered) {
                    pending.setResultCode(Activity.RESULT_OK);
                    pending.setResultData(result.summary());
                }
            } catch (Exception error) {
                String message = "Repair failed: " + LocaleRepair.describe(error);
                saveResult(application, message);
                Log.e(TAG, message, error);
                if (ordered) {
                    pending.setResultCode(Activity.RESULT_CANCELED);
                    pending.setResultData(message);
                }
            } finally {
                pending.finish();
            }
        }, "jmgo-native-english-receiver").start();
    }

    private static void saveResult(Context context, String value) {
        context.getSharedPreferences(LocaleRepair.PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(LocaleRepair.LAST_RESULT, value)
            .putLong(LocaleRepair.LAST_RESULT_TIME, System.currentTimeMillis())
            .apply();
    }
}
