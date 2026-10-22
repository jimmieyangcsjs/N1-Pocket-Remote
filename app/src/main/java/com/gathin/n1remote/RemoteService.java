package com.gathin.n1remote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import java.net.InetSocketAddress;
import java.net.Socket;

public final class RemoteService extends Service {
    static final int PORT = 8088;
    private static final String CHANNEL = "n1remote";
    private static volatile boolean serverRunning;
    private static volatile PointerOverlay pointerOverlay;
    private final Handler main = new Handler(Looper.getMainLooper());
    private RemoteServer server;
    private final Runnable restartServer = this::ensureServer;
    private final Runnable watchdog = this::watchServer;
    private ConnectivityManager connectivity;
    private final ConnectivityManager.NetworkCallback networkCallback =
            new ConnectivityManager.NetworkCallback() {
        @Override
        public void onAvailable(Network network) {
            main.post(() -> {
                ensureServer();
                updateNotification();
            });
        }

        @Override
        public void onLost(Network network) {
            main.post(RemoteService.this::updateNotification);
        }
    };

    static boolean isServerRunning() {
        return serverRunning;
    }

    static PointerOverlay pointer() {
        return pointerOverlay;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL, "N1 Remote", NotificationManager.IMPORTANCE_LOW));
        }
        startForeground(8088, notification());

        pointerOverlay = new PointerOverlay(this);
        connectivity = getSystemService(ConnectivityManager.class);
        if (connectivity != null) {
            try {
                connectivity.registerDefaultNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
            }
        }
        ensureServer();
        new Thread(InputDaemon::warm, "n1remote-input-warmup").start();
        main.postDelayed(watchdog, 30_000);
    }

    private void ensureServer() {
        if (serverRunning) return;
        main.removeCallbacks(restartServer);
        server = new RemoteServer(this, getSharedPreferences("n1remote", MODE_PRIVATE), PORT);
        try {
            server.start();
            serverRunning = true;
        } catch (Exception ignored) {
            serverRunning = false;
            server = null;
            // Port release after a fast reboot, or a transient startup failure, repairs itself without
            // requiring the owner to reopen the app.
            main.postDelayed(restartServer, 3_000);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureServer();
        updateNotification();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        serverRunning = false;
        main.removeCallbacks(restartServer);
        main.removeCallbacks(watchdog);
        if (connectivity != null) {
            try {
                connectivity.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
            }
        }
        if (pointerOverlay != null) {
            pointerOverlay.remove();
            pointerOverlay = null;
        }
        InputDaemon.close();
        if (server != null) server.stop();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification notification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        String ip = RemoteServer.localIpv4();
        String where = "设备IP".equals(ip) ? "等待网络连接" : "http://" + ip + ":" + PORT;
        return builder.setSmallIcon(R.drawable.ic_n1remote_notification)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(where)
                .setOngoing(true)
                .build();
    }

    private void updateNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null && serverRunning) manager.notify(8088, notification());
    }

    /** One cheap loopback probe every 30 seconds; a stuck listener is replaced automatically. */
    private void watchServer() {
        ensureServer();
        if (serverRunning) {
            Thread probe = new Thread(() -> {
                boolean reachable = false;
                try (Socket socket = new Socket()) {
                    socket.connect(new InetSocketAddress("127.0.0.1", PORT), 700);
                    reachable = true;
                } catch (Exception ignored) {
                }
                if (!reachable) main.post(this::replaceServer);
            }, "n1remote-watchdog");
            probe.setDaemon(true);
            probe.start();
        }
        main.postDelayed(watchdog, 30_000);
    }

    private void replaceServer() {
        main.removeCallbacks(restartServer);
        if (server != null) server.stop();
        server = null;
        serverRunning = false;
        ensureServer();
    }
}
