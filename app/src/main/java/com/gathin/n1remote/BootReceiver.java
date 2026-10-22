package com.gathin.n1remote;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !Intent.ACTION_USER_PRESENT.equals(action)
                && !"android.net.conn.CONNECTIVITY_CHANGE".equals(action)
                && !"android.net.wifi.WIFI_STATE_CHANGED".equals(action)) return;
        Intent service = new Intent(context, RemoteService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
        else context.startService(service);
    }
}
