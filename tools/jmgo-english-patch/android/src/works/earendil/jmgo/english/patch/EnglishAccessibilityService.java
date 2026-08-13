package works.earendil.jmgo.english.patch;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.SystemClock;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.view.Gravity;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class EnglishAccessibilityService extends AccessibilityService {
    private static final long DEBOUNCE_MS = 80;
    private static final Pattern FORMAT = Pattern.compile("%%|%(?:\\d+\\$)?[-#+0,(<]*\\d*(?:\\.\\d+)?[bBhHsScCdoxXeEfgGaAtTn]");
    private static final Map<Character, String> FORMAT_PATTERNS;

    static {
        Map<Character, String> patterns = new HashMap<>();
        patterns.put('d', "[-+]?\\d+");
        patterns.put('o', "[-+]?[0-7]+");
        patterns.put('x', "[-+]?[0-9a-fA-F]+");
        patterns.put('X', "[-+]?[0-9a-fA-F]+");
        patterns.put('f', "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)");
        patterns.put('e', "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?");
        patterns.put('E', patterns.get('e'));
        patterns.put('g', patterns.get('e'));
        patterns.put('G', patterns.get('e'));
        patterns.put('a', patterns.get('e'));
        patterns.put('A', patterns.get('e'));
        FORMAT_PATTERNS = Collections.unmodifiableMap(patterns);
    }

    private final Map<String, PackageTranslations> packages = new HashMap<>();
    private long lastTraversal;
    private TranslationOverlay overlay;
    private WindowManager windowManager;

    @Override
    protected void onServiceConnected() {
        try {
            loadCatalog();
            windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            overlay = new TranslationOverlay(this);
            WindowManager.LayoutParams parameters = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                    | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
            );
            parameters.gravity = Gravity.TOP | Gravity.START;
            windowManager.addView(overlay, parameters);
        } catch (Exception error) {
            disableSelf();
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (overlay == null) return;
        long now = SystemClock.uptimeMillis();
        if (now - lastTraversal < DEBOUNCE_MS) return;
        lastTraversal = now;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            overlay.setLabels(Collections.emptyList());
            return;
        }
        try {
            CharSequence packageName = root.getPackageName();
            PackageTranslations translations = packageName == null ? null : packages.get(packageName.toString());
            if (translations == null) {
                overlay.setLabels(Collections.emptyList());
                return;
            }
            List<Label> labels = new ArrayList<>();
            collectLabels(root, translations, labels, new HashSet<String>());
            labels.sort(Comparator.comparingInt(label -> label.bounds.top));
            overlay.setLabels(labels);
        } finally {
            root.recycle();
        }
    }

    @Override
    public void onInterrupt() {
        if (overlay != null) overlay.setLabels(Collections.emptyList());
    }

    @Override
    public void onDestroy() {
        if (windowManager != null && overlay != null) windowManager.removeView(overlay);
        overlay = null;
        super.onDestroy();
    }

    private void loadCatalog() throws Exception {
        byte[] buffer = new byte[8192];
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (InputStream input = getAssets().open("translations.json")) {
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        }
        JSONObject root = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
        JSONObject packageObject = root.getJSONObject("packages");
        Iterator<String> packageNames = packageObject.keys();
        while (packageNames.hasNext()) {
            String packageName = packageNames.next();
            JSONObject source = packageObject.getJSONObject(packageName);
            PackageTranslations translations = new PackageTranslations();
            JSONObject exact = source.getJSONObject("exact");
            Iterator<String> keys = exact.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                translations.exact.put(key, exact.getString(key));
            }
            JSONArray templates = source.getJSONArray("templates");
            for (int index = 0; index < templates.length(); index += 1) {
                JSONObject template = templates.getJSONObject(index);
                translations.templates.add(Template.compile(template.getString("source"), template.getString("translation")));
            }
            packages.put(packageName, translations);
        }
    }

    private void collectLabels(
        AccessibilityNodeInfo node,
        PackageTranslations translations,
        List<Label> labels,
        Set<String> seen
    ) {
        if (node.isVisibleToUser()) {
            CharSequence visible = node.getText();
            if (visible != null && visible.length() > 0) {
                String source = normalize(visible.toString());
                String translated = translations.translate(source);
                if (translated != null && !translated.equals(source)) {
                    Rect bounds = new Rect();
                    node.getBoundsInScreen(bounds);
                    String identity = bounds.flattenToString() + '\u0000' + translated;
                    if (!bounds.isEmpty() && seen.add(identity)) labels.add(new Label(bounds, translated));
                }
            }
        }

        int children = node.getChildCount();
        for (int index = 0; index < children; index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            try {
                collectLabels(child, translations, labels, seen);
            } finally {
                child.recycle();
            }
        }
    }

    private static String normalize(String value) {
        return value.replace('\u00a0', ' ').replaceAll("\\s+", " ").trim();
    }

    private static final class PackageTranslations {
        final Map<String, String> exact = new HashMap<>();
        final List<Template> templates = new ArrayList<>();

        String translate(String source) {
            String exactTranslation = exact.get(source);
            if (exactTranslation != null) return exactTranslation;
            for (Template template : templates) {
                String result = template.apply(source);
                if (result != null) return result;
            }
            return null;
        }
    }

    private static final class Template {
        final Pattern source;
        final String translation;
        final int groups;

        Template(Pattern source, String translation, int groups) {
            this.source = source;
            this.translation = translation;
            this.groups = groups;
        }

        static Template compile(String source, String translation) {
            Matcher matcher = FORMAT.matcher(source);
            StringBuilder regex = new StringBuilder("^");
            int cursor = 0;
            int groups = 0;
            while (matcher.find()) {
                regex.append(Pattern.quote(source.substring(cursor, matcher.start())));
                String format = matcher.group();
                if ("%%".equals(format)) {
                    regex.append("%");
                } else {
                    char type = format.charAt(format.length() - 1);
                    int explicit = explicitArgumentIndex(format);
                    int group = explicit > 0 ? explicit : groups + 1;
                    if (group <= groups) regex.append("\\").append(group);
                    else {
                        regex.append('(').append(FORMAT_PATTERNS.getOrDefault(type, ".+?")).append(')');
                        groups += 1;
                    }
                }
                cursor = matcher.end();
            }
            regex.append(Pattern.quote(source.substring(cursor))).append('$');
            return new Template(Pattern.compile(regex.toString(), Pattern.DOTALL), translation, groups);
        }

        private static int explicitArgumentIndex(String format) {
            Matcher index = Pattern.compile("^%(\\d+)\\$").matcher(format);
            return index.find() ? Integer.parseInt(index.group(1)) : -1;
        }

        String apply(String value) {
            Matcher matcher = source.matcher(value);
            if (!matcher.matches()) return null;
            Matcher outputFormats = FORMAT.matcher(translation);
            StringBuffer output = new StringBuffer();
            int group = 1;
            while (outputFormats.find()) {
                String replacement = outputFormats.group();
                if ("%%".equals(replacement)) {
                    replacement = "%";
                } else {
                    int explicit = explicitArgumentIndex(replacement);
                    int argument = explicit > 0 ? explicit : group++;
                    if (argument <= groups) replacement = matcher.group(argument);
                }
                outputFormats.appendReplacement(output, Matcher.quoteReplacement(replacement));
            }
            outputFormats.appendTail(output);
            return output.toString();
        }
    }

    private static final class Label {
        final Rect bounds;
        final String text;

        Label(Rect bounds, String text) {
            this.bounds = new Rect(bounds);
            this.text = text;
        }
    }

    private static final class TranslationOverlay extends android.view.View {
        private final Paint background = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final TextPaint foreground = new TextPaint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        private List<Label> labels = Collections.emptyList();

        TranslationOverlay(Context context) {
            super(context);
            setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
            background.setColor(Color.rgb(16, 16, 16));
            background.setStyle(Paint.Style.FILL);
            foreground.setColor(Color.WHITE);
            foreground.setTypeface(android.graphics.Typeface.create("sans", android.graphics.Typeface.NORMAL));
        }

        void setLabels(List<Label> labels) {
            this.labels = new ArrayList<>(labels);
            postInvalidateOnAnimation();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            for (Label label : labels) drawLabel(canvas, label);
        }

        private void drawLabel(Canvas canvas, Label label) {
            Rect bounds = label.bounds;
            int[] location = new int[2];
            getLocationOnScreen(location);
            bounds = new Rect(
                bounds.left - location[0],
                bounds.top - location[1],
                bounds.right - location[0],
                bounds.bottom - location[1]
            );
            float density = getResources().getDisplayMetrics().density;
            int padding = Math.max(2, Math.round(3 * density));
            float desiredSize = Math.max(10 * density, Math.min(22 * density, bounds.height() * 0.58f));
            foreground.setTextSize(desiredSize);
            int preferredWidth = Math.min(
                Math.max(bounds.width(), getWidth() / 3),
                Math.round(foreground.measureText(label.text)) + 2 * padding
            );
            int rightLimit = bounds.width() < getWidth() / 8 && bounds.left < getWidth() / 5
                ? getWidth() / 5
                : getWidth() - padding;
            bounds.right = Math.max(bounds.right, Math.min(rightLimit, bounds.left + preferredWidth));
            canvas.drawRect(bounds, background);

            int width = Math.max(1, bounds.width() - 2 * padding);
            StaticLayout layout = StaticLayout.Builder
                .obtain(label.text, 0, label.text.length(), foreground, width)
                .setAlignment(Layout.Alignment.ALIGN_CENTER)
                .setIncludePad(false)
                .setMaxLines(Math.max(1, bounds.height() / Math.max(1, Math.round(desiredSize))))
                .build();
            while (layout.getHeight() > bounds.height() - 2 * padding && foreground.getTextSize() > 9 * density) {
                foreground.setTextSize(foreground.getTextSize() - density);
                layout = StaticLayout.Builder
                    .obtain(label.text, 0, label.text.length(), foreground, width)
                    .setAlignment(Layout.Alignment.ALIGN_CENTER)
                    .setIncludePad(false)
                    .build();
            }
            float top = bounds.top + Math.max(padding, (bounds.height() - layout.getHeight()) / 2f);
            canvas.save();
            canvas.translate(bounds.left + padding, top);
            layout.draw(canvas);
            canvas.restore();
        }
    }
}
