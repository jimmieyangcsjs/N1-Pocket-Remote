package com.gathin.n1remote;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Point;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

/**
 * A small, non-interactive pointer drawn above other apps. Tap/swipe gestures are translated to
 * absolute touch injections at this pointer's position, so ordinary Android TV apps that do not
 * render a hardware mouse cursor still get predictable click and long-press behaviour.
 */
final class PointerOverlay {
    private static final String TAG = "N1Remote.Pointer";
    private final Context context;
    private final WindowManager windows;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final CursorView cursor;
    private volatile boolean attached;
    private volatile boolean appOpEnsured;
    private int screenWidth;
    private int screenHeight;
    private volatile float x;
    private volatile float y;

    PointerOverlay(Context context) {
        this.context = context.getApplicationContext();
        windows = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        Display display = windows.getDefaultDisplay();
        Point size = new Point();
        display.getRealSize(size);
        screenWidth = Math.max(1, size.x);
        screenHeight = Math.max(1, size.y);
        x = screenWidth * 0.5f;
        y = screenHeight * 0.5f;
        cursor = new CursorView(context);
        cursor.setTag(this);
    }

    private boolean attachOnMain() {
        if (attached) return true;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                Build.VERSION.SDK_INT >= 26
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_FULLSCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                android.graphics.PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        try {
            windows.addView(cursor, params);
            cursor.setVisibility(View.GONE);
            attached = true;
            return true;
        } catch (RuntimeException e) {
            attached = false;
            Log.w(TAG, "pointer overlay attach failed", e);
            return false;
        }
    }

    int[] show() {
        ensureAppOp();
        refreshSize();
        reveal();
        return position();
    }

    void hide() {
        main.post(() -> cursor.setVisibility(View.GONE));
    }

    int[] move(float dx, float dy) {
        ensureAppOp();
        refreshSize();
        float margin = 12f * context.getResources().getDisplayMetrics().density;
        x = clamp(x + dx * screenWidth, margin, screenWidth - margin);
        y = clamp(y + dy * screenHeight, margin, screenHeight - margin);
        reveal();
        return position();
    }

    int[] position() {
        return new int[]{Math.round(x), Math.round(y), screenWidth, screenHeight};
    }

    void remove() {
        if (!attached) return;
        Runnable remove = () -> {
            try {
                windows.removeView(cursor);
            } catch (RuntimeException ignored) {
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) remove.run();
        else main.post(remove);
        attached = false;
    }

    private void ensureAppOp() {
        if (appOpEnsured) return;
        appOpEnsured = true;
        // Some API-25 vendor images report canDrawOverlays=true before the app-op is explicitly
        // recorded, then reject addView. Set it once per process, lazily from the touch page.
        Shell.run("appops set com.gathin.n1remote SYSTEM_ALERT_WINDOW allow");
    }

    private void refreshSize() {
        Point size = new Point();
        windows.getDefaultDisplay().getRealSize(size);
        screenWidth = Math.max(1, size.x);
        screenHeight = Math.max(1, size.y);
        x = clamp(x, 0, screenWidth);
        y = clamp(y, 0, screenHeight);
    }

    private void reveal() {
        Runnable attach = () -> {
            if (!attachOnMain()) return;
            cursor.setVisibility(View.VISIBLE);
            cursor.invalidate();
        };
        main.post(attach);
        // The first app-op write can take a moment to propagate in old vendor PermissionManager.
        main.postDelayed(attach, 350);
        main.postDelayed(attach, 1_200);
    }

    private static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private static final class CursorView extends View {
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final float scale;

        CursorView(Context context) {
            super(context);
            scale = context.getResources().getDisplayMetrics().density;
            fill.setColor(0xFFFF995F);
            ring.setColor(0xE6F7F1E8);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(Math.max(1.5f, 1.4f * scale));
            setBackgroundColor(Color.TRANSPARENT);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            PointerOverlay owner = (PointerOverlay) getTag();
            if (owner == null) return;
            float radiusOuter = 11f * scale;
            float radiusInner = 5.5f * scale;
            canvas.drawCircle(owner.x, owner.y, radiusOuter, ring);
            canvas.drawCircle(owner.x, owner.y, radiusInner, fill);
            canvas.drawLine(owner.x - radiusOuter - 3f * scale, owner.y,
                    owner.x - radiusOuter + 1f * scale, owner.y, ring);
            canvas.drawLine(owner.x + radiusOuter - 1f * scale, owner.y,
                    owner.x + radiusOuter + 3f * scale, owner.y, ring);
            canvas.drawLine(owner.x, owner.y - radiusOuter - 3f * scale,
                    owner.x, owner.y - radiusOuter + 1f * scale, ring);
            canvas.drawLine(owner.x, owner.y + radiusOuter - 1f * scale,
                    owner.x, owner.y + radiusOuter + 3f * scale, ring);
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            return false;
        }
    }
}
