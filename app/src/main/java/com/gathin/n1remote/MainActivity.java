package com.gathin.n1remote;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.TextView;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService checks = Executors.newSingleThreadExecutor();
    private TextView serviceStatus;
    private TextView rootStatus;
    private TextView address;
    private TextView pinView;
    private ImageView qrCode;
    private View serviceDot;
    private View rootDot;
    private String lastQrUrl;
    private final Runnable refreshConnection = new Runnable() {
        @Override
        public void run() {
            refreshConnectionInfo();
            checkService();
            main.postDelayed(this, 15_000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        setContentView(R.layout.activity_main);

        SharedPreferences prefs = getSharedPreferences("n1remote", MODE_PRIVATE);
        address = findViewById(R.id.address);
        pinView = findViewById(R.id.pin);
        qrCode = findViewById(R.id.qrCode);
        serviceStatus = findViewById(R.id.serviceStatus);
        rootStatus = findViewById(R.id.rootStatus);
        serviceDot = findViewById(R.id.serviceDot);
        rootDot = findViewById(R.id.rootDot);
        View rootPill = findViewById(R.id.rootPill);
        rootPill.setOnClickListener(v -> checkPermissions());
        rootPill.setOnFocusChangeListener((view, focused) ->
                view.animate().scaleX(focused ? 1.025f : 1f)
                        .scaleY(focused ? 1.025f : 1f).setDuration(140).start());
        refreshConnectionInfo();

        Intent service = new Intent(this, RemoteService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service);
        else startService(service);
        checkService();
        checkPermissions();
    }

    @Override
    protected void onResume() {
        super.onResume();
        main.removeCallbacks(refreshConnection);
        main.post(refreshConnection);
    }

    @Override
    protected void onPause() {
        main.removeCallbacks(refreshConnection);
        super.onPause();
    }

    private void refreshConnectionInfo() {
        SharedPreferences prefs = getSharedPreferences("n1remote", MODE_PRIVATE);
        String pin = RemoteServer.ensurePin(prefs);
        checks.execute(() -> {
            String url = "http://" + RemoteServer.localIpv4() + ":" + RemoteService.PORT;
            String target = url + "/?pin=" + pin;
            main.post(() -> {
                if (isDestroyed()) return;
                address.setText(url);
                pinView.setText(pin);
                if (!target.equals(lastQrUrl)) {
                    qrCode.setImageBitmap(qr(target));
                    lastQrUrl = target;
                }
            });
        });
    }

    private void checkService() {
        checks.execute(() -> {
            boolean online = false;
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", RemoteService.PORT), 700);
                online = true;
            } catch (Exception ignored) {
            }
            boolean result = online;
            main.post(() -> {
                if (isDestroyed()) return;
                serviceStatus.setText(result ? "控制服务在线" : "服务启动中");
                int color = result ? 0xFF65E2CD : 0xFFFFB16E;
                serviceStatus.setTextColor(color);
                tint(serviceDot, color);
            });
        });
    }

    private void checkPermissions() {
        rootStatus.setText("正在检查 SuperSU");
        rootStatus.setTextColor(0xFFD7E7EA);
        tint(rootDot, 0xFFFFB16E);
        checks.execute(() -> {
            boolean root = Shell.isRoot();
            main.post(() -> {
                if (isDestroyed()) return;
                rootStatus.setText(root ? "SuperSU 已授权" : "点此检查 SuperSU");
                int color = root ? 0xFF65E2CD : 0xFFFF8E89;
                rootStatus.setTextColor(color);
                tint(rootDot, color);
            });
        });
    }

    private void tint(View view, int color) {
        if (view == null) return;
        Drawable background = view.getBackground();
        if (background != null) background.mutate().setTint(color);
    }

    private Bitmap qr(String content) {
        try {
            int size = 768;
            Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
            hints.put(EncodeHintType.MARGIN, 1);
            hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
            BitMatrix matrix = new MultiFormatWriter().encode(
                    content, BarcodeFormat.QR_CODE, size, size, hints);
            int[] pixels = new int[size * size];
            for (int y = 0; y < size; y++) {
                for (int x = 0; x < size; x++) {
                    pixels[y * size + x] = matrix.get(x, y) ? Color.BLACK : Color.WHITE;
                }
            }
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            bitmap.setPixels(pixels, 0, size, 0, 0, size, size);
            return bitmap;
        } catch (Exception e) {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(refreshConnection);
        checks.shutdownNow();
        super.onDestroy();
    }
}
