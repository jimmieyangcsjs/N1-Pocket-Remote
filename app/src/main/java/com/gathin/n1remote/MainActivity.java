package com.gathin.n1remote;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_main);

        SharedPreferences prefs = getSharedPreferences("n1remote", MODE_PRIVATE);
        String pin = RemoteServer.ensurePin(prefs);
        String url = "http://" + RemoteServer.localIpv4() + ":" + RemoteService.PORT;
        ((TextView) findViewById(R.id.address)).setText(url);
        ((TextView) findViewById(R.id.pin)).setText(pin);
        ((ImageView) findViewById(R.id.qrCode)).setImageBitmap(qr(url + "/?pin=" + pin));

        serviceStatus = findViewById(R.id.serviceStatus);
        rootStatus = findViewById(R.id.rootStatus);
        rootStatus.setOnClickListener(v -> checkPermissions());

        Intent service = new Intent(this, RemoteService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service);
        else startService(service);
        checkService();
        checkPermissions();
    }

    @Override
    protected void onResume() {
        super.onResume();
        checkService();
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
                serviceStatus.setText(result ? "●  控制服务在线" : "●  服务启动中");
                serviceStatus.setTextColor(result ? 0xFFA7D4C3 : 0xFFFFB287);
            });
        });
    }

    private void checkPermissions() {
        rootStatus.setText("正在检查 SuperSU");
        rootStatus.setTextColor(0xFFF4EEE5);
        checks.execute(() -> {
            boolean root = Shell.isRoot();
            main.post(() -> {
                if (isDestroyed()) return;
                rootStatus.setText(root ? "SuperSU 已授权" : "点此检查 SuperSU");
                rootStatus.setTextColor(root ? 0xFFA7D4C3 : 0xFFFFA19B);
            });
        });
    }

    private Bitmap qr(String content) {
        try {
            Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
            hints.put(EncodeHintType.MARGIN, 1);
            hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
            BitMatrix matrix = new MultiFormatWriter().encode(
                    content, BarcodeFormat.QR_CODE, 512, 512, hints);
            int[] pixels = new int[512 * 512];
            for (int y = 0; y < 512; y++) {
                for (int x = 0; x < 512; x++) {
                    pixels[y * 512 + x] = matrix.get(x, y) ? Color.BLACK : Color.WHITE;
                }
            }
            Bitmap bitmap = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888);
            bitmap.setPixels(pixels, 0, 512, 0, 0, 512, 512);
            return bitmap;
        } catch (Exception e) {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }

    @Override
    protected void onDestroy() {
        checks.shutdownNow();
        super.onDestroy();
    }
}
