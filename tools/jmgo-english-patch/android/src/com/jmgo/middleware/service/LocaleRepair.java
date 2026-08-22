package com.jmgo.middleware.service;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.LocaleList;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Locale;

public final class LocaleRepair {
    static final String PREFERENCES = "native_english";
    static final String BOOT_REPAIR = "repair_at_boot";
    static final String LAST_RESULT = "last_result";
    static final String LAST_RESULT_TIME = "last_result_time";

    private static final ComponentName SETTING_SERVICE = new ComponentName(
        "com.jmgo.setting.x",
        "com.jmgo.setting.SettingService"
    );
    private static final Locale TEMPORARY_LOCALE = Locale.UK;
    private static final Locale FINAL_LOCALE = Locale.ENGLISH;

    private LocaleRepair() {
    }

    public static boolean hasConfigurationPermission(Context context) {
        return context.checkCallingOrSelfPermission(Manifest.permission.CHANGE_CONFIGURATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean isBootRepairEnabled(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getBoolean(BOOT_REPAIR, true);
    }

    public static void setBootRepairEnabled(Context context, boolean enabled) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(BOOT_REPAIR, enabled)
            .apply();
    }

    public static synchronized Result applyNativeEnglish(Context context) throws Exception {
        Context application = context.getApplicationContext();
        if (!hasConfigurationPermission(application)) {
            throw new SecurityException(
                "CHANGE_CONFIGURATION is not granted. Use the host installer or grant it over ADB."
            );
        }

        String before = primaryLocaleTag();
        Intent settingService = new Intent().setComponent(SETTING_SERVICE);
        boolean stopRequested = application.stopService(settingService);
        Thread.sleep(750L);

        Exception failure = null;
        boolean finalLocaleApplied = false;
        try {
            updateSystemLocale(TEMPORARY_LOCALE);
            Thread.sleep(1000L);
            updateSystemLocale(FINAL_LOCALE);
            finalLocaleApplied = true;
            Thread.sleep(1000L);
        } catch (Exception error) {
            failure = unwrap(error);
        } finally {
            if (!finalLocaleApplied) {
                try {
                    updateSystemLocale(FINAL_LOCALE);
                    Thread.sleep(500L);
                } catch (Exception restoreError) {
                    Exception unwrapped = unwrap(restoreError);
                    if (failure == null) failure = unwrapped;
                    else failure.addSuppressed(unwrapped);
                }
            }

            try {
                ComponentName started = application.startService(settingService);
                if (started == null) throw new IllegalStateException("JMGO SettingService did not start");
            } catch (Exception restoreError) {
                if (failure == null) failure = restoreError;
                else failure.addSuppressed(restoreError);
            }
        }

        if (failure != null) throw failure;
        String after = primaryLocaleTag();
        if (!"en".equals(after)) {
            throw new IllegalStateException("System locale is " + after + " after repair");
        }
        return new Result(before, after, stopRequested);
    }

    public static String primaryLocaleTag() throws Exception {
        Configuration configuration = currentConfiguration(activityManager());
        LocaleList locales = configuration.getLocales();
        return locales.isEmpty() ? "" : locales.get(0).toLanguageTag();
    }

    public static String describe(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null && current.getCause() != current) current = current.getCause();
        String message = current.getMessage();
        return current.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private static void updateSystemLocale(Locale locale) throws Exception {
        Object manager = activityManager();
        Configuration configuration = currentConfiguration(manager);
        configuration.setLocales(new LocaleList(locale));
        try {
            Field userSetLocale = Configuration.class.getField("userSetLocale");
            userSetLocale.setBoolean(configuration, true);
        } catch (ReflectiveOperationException ignored) {
        }

        Method update = manager.getClass().getMethod("updateConfiguration", Configuration.class);
        update.invoke(manager, configuration);
    }

    private static Object activityManager() throws Exception {
        Class<?> managerClass = Class.forName("android.app.ActivityManagerNative");
        return managerClass.getMethod("getDefault").invoke(null);
    }

    private static Configuration currentConfiguration(Object manager) throws Exception {
        return (Configuration) manager.getClass().getMethod("getConfiguration").invoke(manager);
    }

    private static Exception unwrap(Exception error) {
        if (error instanceof InvocationTargetException) {
            Throwable cause = ((InvocationTargetException) error).getTargetException();
            if (cause instanceof Exception) return (Exception) cause;
        }
        return error;
    }

    public static final class Result {
        public final String before;
        public final String after;
        public final boolean settingServiceWasRunning;

        Result(String before, String after, boolean settingServiceWasRunning) {
            this.before = before;
            this.after = after;
            this.settingServiceWasRunning = settingServiceWasRunning;
        }

        public String summary() {
            return "Native English active (" + before + " -> " + after
                + "); JMGO SettingService restored";
        }
    }
}
