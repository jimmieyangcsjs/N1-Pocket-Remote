package com.gathin.n1remote;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.util.AttributeSet;
import android.widget.FrameLayout;

/**
 * Lightweight static backdrop for the TV dashboard. All geometry is resolution independent, so
 * the same drawing remains crisp on 1080p and 4K displays without a bitmap or animation loop.
 */
public final class TvBackdropLayout extends FrameLayout {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float density;

    public TvBackdropLayout(Context context) {
        this(context, null);
    }

    public TvBackdropLayout(Context context, AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public TvBackdropLayout(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        density = getResources().getDisplayMetrics().density;
        setWillNotDraw(false);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        int height = getHeight();
        if (width == 0 || height == 0) return;

        paint.setStyle(Paint.Style.FILL);
        paint.setShader(new LinearGradient(
                0, 0, width * 0.8f, height,
                new int[]{0xFF07141B, 0xFF040B10, 0xFF020609},
                new float[]{0f, 0.58f, 1f},
                Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, width, height, paint);

        paint.setShader(new RadialGradient(
                width * 0.11f, height * 0.02f, Math.max(width, height) * 0.62f,
                new int[]{0x2A2AC4C9, 0x0C16737D, 0x00000000},
                new float[]{0f, 0.42f, 1f},
                Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, width, height, paint);

        paint.setShader(new RadialGradient(
                width * 0.91f, height * 0.82f, Math.max(width, height) * 0.42f,
                new int[]{0x1D4C7CD8, 0x08264776, 0x00000000},
                new float[]{0f, 0.45f, 1f},
                Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, width, height, paint);
        paint.setShader(null);

        float spacing = 44f * density;
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(1f, density * 0.55f));
        paint.setColor(0x0D6ED5D9);
        for (float x = -height; x < width + height; x += spacing) {
            canvas.drawLine(x, 0, x + height * 0.34f, height, paint);
        }
        paint.setColor(0x0868CFD5);
        for (float y = spacing; y < height; y += spacing) {
            canvas.drawLine(0, y, width, y, paint);
        }

        float ringX = width * 0.84f;
        float ringY = height * 0.5f;
        float ringRadius = Math.min(width, height) * 0.33f;
        paint.setStrokeWidth(Math.max(1f, density * 0.8f));
        paint.setColor(0x1F67D7DE);
        canvas.drawCircle(ringX, ringY, ringRadius, paint);
        paint.setColor(0x104DA2C4);
        canvas.drawCircle(ringX, ringY, ringRadius * 1.14f, paint);

        paint.setStyle(Paint.Style.FILL);
        paint.setShader(new LinearGradient(
                0, height * 0.9f, width, height,
                new int[]{0x00000000, 0x70010507},
                null, Shader.TileMode.CLAMP));
        canvas.drawRect(0, height * 0.82f, width, height, paint);
        paint.setShader(null);
    }
}
