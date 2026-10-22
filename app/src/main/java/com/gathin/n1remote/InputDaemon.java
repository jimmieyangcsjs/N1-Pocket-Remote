package com.gathin.n1remote;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Low-latency key injection through the Amlogic keyboard event device.
 *
 * <p>Android's {@code input} command starts a Java VM for every key and takes roughly one
 * second on N1. A single root-owned {@code cat} process keeps the event device open, so each
 * press only writes two small kernel input_event records.</p>
 */
final class InputDaemon {
    private static final int EV_SYN = 0;
    private static final int EV_KEY = 1;
    private static final int SYN_REPORT = 0;
    private static Process process;
    private static OutputStream output;

    private InputDaemon() { }

    static synchronized void warm() {
        ensureStarted();
    }

    static boolean key(int androidKeyCode, boolean longPress) {
        int linuxCode = linuxKey(androidKeyCode);
        if (linuxCode < 0) return false;
        OutputStream stream;
        synchronized (InputDaemon.class) {
            if (!ensureStarted()) return false;
            stream = output;
        }
        try {
            writeKey(stream, linuxCode, 1);
            if (longPress) {
                try {
                    Thread.sleep(650);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            writeKey(stream, linuxCode, 0);
            stream.flush();
            return true;
        } catch (Exception e) {
            synchronized (InputDaemon.class) {
                closeLocked();
            }
            return false;
        }
    }

    static synchronized void close() {
        closeLocked();
    }

    private static boolean ensureStarted() {
        if (process != null) {
            try {
                process.exitValue();
                closeLocked();
            } catch (IllegalThreadStateException alive) {
                return output != null;
            }
        }
        try {
            process = new ProcessBuilder("su", "-c", "cat > " + keyboardDevice())
                    .redirectErrorStream(true)
                    .start();
            output = process.getOutputStream();
            return true;
        } catch (Exception e) {
            closeLocked();
            return false;
        }
    }

    private static void closeLocked() {
        if (output != null) {
            try {
                output.close();
            } catch (Exception ignored) {
            }
            output = null;
        }
        if (process != null) {
            process.destroy();
            process = null;
        }
    }

    private static void writeKey(OutputStream stream, int code, int value) throws Exception {
        stream.write(inputEvent(EV_KEY, code, value));
        stream.write(inputEvent(EV_SYN, SYN_REPORT, 0));
    }

    private static byte[] inputEvent(int type, int code, int value) {
        ByteBuffer event = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN);
        event.putLong(0L);
        event.putLong(0L);
        event.putShort((short) type);
        event.putShort((short) code);
        event.putInt(value);
        return event.array();
    }

    private static int linuxKey(int androidKeyCode) {
        switch (androidKeyCode) {
            case 3: return 102;    // HOME
            case 4: return 158;    // BACK
            case 19: return 103;   // DPAD_UP
            case 20: return 108;   // DPAD_DOWN
            case 21: return 105;   // DPAD_LEFT
            case 22: return 106;   // DPAD_RIGHT
            case 23: return 28;    // DPAD_CENTER / ENTER
            case 24: return 115;   // VOLUME_UP
            case 25: return 114;   // VOLUME_DOWN
            case 66: return 28;    // ENTER
            case 82: return 139;   // MENU
            case 164: return 113;  // MUTE
            case 85: return 164;   // MEDIA_PLAY_PAUSE
            default: return -1;
        }
    }

    /** Event numbers can move when other input devices appear, so resolve the known device by name. */
    private static String keyboardDevice() {
        for (int i = 0; i < 16; i++) {
            String path = "/sys/class/input/event" + i + "/device/name";
            try (BufferedReader reader = new BufferedReader(new FileReader(path))) {
                String name = reader.readLine();
                if (name != null && (name.contains("mini keyboard") || name.contains("aml_keypad"))) {
                    return "/dev/input/event" + i;
                }
            } catch (Exception ignored) {
            }
        }
        return "/dev/input/event4";
    }
}
