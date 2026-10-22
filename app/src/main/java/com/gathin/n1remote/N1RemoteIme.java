package com.gathin.n1remote;

import android.inputmethodservice.InputMethodService;
import android.os.Handler;
import android.os.Looper;
import android.view.inputmethod.InputConnection;

import java.lang.ref.WeakReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class N1RemoteIme extends InputMethodService {
    private static WeakReference<N1RemoteIme> active;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void onStartInput(android.view.inputmethod.EditorInfo info, boolean restarting) {
        super.onStartInput(info, restarting);
        active = new WeakReference<>(this);
    }

    @Override
    public void onStartInputView(android.view.inputmethod.EditorInfo info, boolean restarting) {
        super.onStartInputView(info, restarting);
        active = new WeakReference<>(this);
    }

    @Override
    public void onFinishInput() {
        active = null;
        super.onFinishInput();
    }

    static boolean commit(String text) {
        N1RemoteIme ime = active == null ? null : active.get();
        if (ime == null) return false;
        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean committed = new AtomicBoolean(false);
        ime.main.post(() -> {
            InputConnection connection = ime.getCurrentInputConnection();
            if (connection != null) committed.set(connection.commitText(text, 1));
            done.countDown();
        });
        try {
            done.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        return committed.get();
    }
}
