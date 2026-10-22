package com.gathin.n1remote;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Build;

/**
 * Read-only status for the N1 launcher.
 *
 * <p>The provider is protected by a signature permission, so only an APK signed with the same
 * certificate can read the PIN. The launcher uses this to put a working QR code on Home without
 * opening an unauthenticated status endpoint on the LAN.</p>
 */
public final class StatusProvider extends ContentProvider {
    static final String AUTHORITY = "com.gathin.n1remote.status";
    static final Uri CONTENT_URI = Uri.parse("content://" + AUTHORITY + "/status");
    static final String READ_PERMISSION = "com.gathin.n1remote.permission.READ_STATUS";
    private static final String[] COLUMNS = {"ip", "port", "pin", "serviceOnline", "url"};

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs,
                        String sortOrder) {
        if (!"status".equals(uri.getLastPathSegment())) return null;
        ensureService();
        SharedPreferences prefs = getContext().getSharedPreferences("n1remote", 0);
        String pin = RemoteServer.ensurePin(prefs);
        String ip = RemoteServer.localIpv4();
        int port = RemoteService.PORT;
        boolean online = RemoteService.isServerRunning();
        String url = "http://" + ip + ":" + port + "/?pin=" + pin;

        MatrixCursor cursor = new MatrixCursor(COLUMNS, 1);
        cursor.addRow(new Object[]{ip, port, pin, online ? 1 : 0, url});
        return cursor;
    }

    /**
     * Home reads this provider very early after boot. Starting the service here is a second,
     * independent recovery path if the BOOT_COMPLETED broadcast raced package manager startup.
     */
    private void ensureService() {
        if (RemoteService.isServerRunning()) return;
        Context context = getContext();
        if (context == null) return;
        Intent service = new Intent(context, RemoteService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
            else context.startService(service);
        } catch (RuntimeException ignored) {
        }
    }

    @Override
    public String getType(Uri uri) {
        return "vnd.android.cursor.item/vnd.com.gathin.n1remote.status";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("N1 Remote status is read-only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("N1 Remote status is read-only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("N1 Remote status is read-only");
    }
}
