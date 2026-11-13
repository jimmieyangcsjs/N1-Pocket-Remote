package com.gathin.n1remote;

import android.content.Context;
import android.net.LocalSocket;
import android.net.LocalSocketAddress;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Locale;

/**
 * Owns one scrcpy-server process and exposes its raw H.264/control sockets.
 *
 * <p>This is the same architecture used by YA-webadb: scrcpy performs screen capture and input
 * injection while the browser only decodes the video. The N1's local adb port is never exposed
 * by this class.</p>
 */
final class ScrcpyMirror {
    static final String SERVER_VERSION = "5.0.1";
    static final String SERVER_PATH = "/data/local/tmp/n1remote-scrcpy-server.jar";

    private static final int SOCKET_CONNECT_TIMEOUT_MS = 9_000;
    private static final long PACKET_FLAG_CONFIG = 1L << 62;
    private static final long PACKET_FLAG_KEY_FRAME = 1L << 61;
    private static final long PACKET_FLAG_MASK = ~(PACKET_FLAG_CONFIG | PACKET_FLAG_KEY_FRAME);
    private static final long POINTER_ID_GENERIC_FINGER = -2L;

    static final class Packet {
        final long flags;
        final byte[] data;

        Packet(long flags, byte[] data) {
            this.flags = flags;
            this.data = data;
        }

        boolean isConfig() {
            return (flags & PACKET_FLAG_CONFIG) != 0;
        }

        boolean isKeyFrame() {
            return (flags & PACKET_FLAG_KEY_FRAME) != 0;
        }

        long presentationTimeUs() {
            return flags & PACKET_FLAG_MASK;
        }
    }

    private final Context context;
    private final Object lock = new Object();
    private final SecureRandom random = new SecureRandom();
    private Process process;
    private Thread logDrain;
    private String scid;
    private String codec = "avc1.42E01E";
    private int width = 1920;
    private int height = 1080;
    private LocalSocket videoSocket;
    private LocalSocket controlSocket;
    private InputStream videoInput;
    private ScrcpyStreamReader streamReader;
    private OutputStream controlOutput;
    private boolean videoClaimed;
    private boolean pointerDown;
    private int pointerX;
    private int pointerY;
    private volatile String lastLog = "";

    ScrcpyMirror(Context context) {
        this.context = context;
    }

    boolean isRunning() {
        synchronized (lock) {
            return socketsReady() && processAlive();
        }
    }

    boolean isVideoClaimed() {
        synchronized (lock) {
            return videoClaimed;
        }
    }

    String codec() {
        synchronized (lock) {
            return codec;
        }
    }

    int width() {
        synchronized (lock) {
            return width;
        }
    }

    int height() {
        synchronized (lock) {
            return height;
        }
    }

    String statusMessage() {
        if (isRunning()) return "ready";
        String log = lastLog;
        return log.isEmpty() ? "stopped" : log;
    }

    void start(int screenWidth, int screenHeight) throws Exception {
        synchronized (lock) {
            width = Math.max(1, screenWidth);
            height = Math.max(1, screenHeight);
            if (socketsReady() && processAlive()) return;
            closeLocked();

            if (!Shell.isRoot()) {
                throw new IllegalStateException("scrcpy 镜像需要 SuperSU 授权");
            }
            stageServer();

            scid = String.format(Locale.US, "%08x", 1 + random.nextInt(0x7FFFFFFE));
            String command = "export CLASSPATH=" + SERVER_PATH
                    + "; /system/bin/app_process / com.genymobile.scrcpy.Server "
                    + SERVER_VERSION
                    + " scid=" + scid
                    + " log_level=info"
                    + " video=true audio=false control=true"
                    + " video_codec=h264 video_bit_rate=8000000 max_fps=60"
                    + " tunnel_forward=true"
                    + " send_device_meta=false send_frame_meta=true"
                    + " send_dummy_byte=false send_stream_meta=true"
                    + " cleanup=false power_on=true stay_awake=true"
                    + " clipboard_autosync=false";

            try {
                process = new ProcessBuilder(
                        "su", "--context", "u:r:shell:s0", "-c", command)
                        .redirectErrorStream(true)
                        .start();
                drainProcessOutput();

                String socketName = "scrcpy_" + scid;
                videoSocket = connect(socketName, SOCKET_CONNECT_TIMEOUT_MS);
                controlSocket = connect(socketName, SOCKET_CONNECT_TIMEOUT_MS);
                videoInput = videoSocket.getInputStream();
                controlOutput = controlSocket.getOutputStream();
                streamReader = new ScrcpyStreamReader(videoInput);
                streamReader.readStreamHeader();
                width = streamReader.width();
                height = streamReader.height();
                videoClaimed = false;
                pointerDown = false;
            } catch (Exception error) {
                closeLocked();
                throw error;
            }
        }
    }

    Packet readVideoPacket() throws IOException {
        ScrcpyStreamReader reader;
        synchronized (lock) {
            reader = streamReader;
            if (reader == null) throw new IOException("scrcpy 视频通道未连接");
        }
        // Never hold the shared state lock while waiting for the encoder. A static TV screen can
        // pause packets for seconds, which would otherwise block touch injection behind the read.
        ScrcpyStreamReader.Frame frame = reader.readFrame();
        synchronized (lock) {
            width = frame.width;
            height = frame.height;
        }
        return new Packet(frame.flags, frame.data);
    }

    void claimVideo() {
        synchronized (lock) {
            if (videoClaimed) throw new IllegalStateException("已有手机正在使用实时镜像");
            videoClaimed = true;
        }
    }

    void releaseVideo() {
        synchronized (lock) {
            videoClaimed = false;
        }
    }

    void injectTouch(int action, float normalizedX, float normalizedY) throws IOException {
        synchronized (lock) {
            if (controlOutput == null) throw new IOException("scrcpy 控制通道未连接");
            float nx = clamp01(normalizedX);
            float ny = clamp01(normalizedY);
            int x = Math.max(0, Math.min(width - 1, Math.round(nx * (width - 1))));
            int y = Math.max(0, Math.min(height - 1, Math.round(ny * (height - 1))));
            pointerX = x;
            pointerY = y;
            writeTouchLocked(action, x, y);
        }
    }

    private void writeTouchLocked(int action, int x, int y) throws IOException {
        // control_msg.h: type, action, pointer id, position, pressure, action button, buttons.
        byte[] packet = new byte[32];
        packet[0] = 2; // TYPE_INJECT_TOUCH_EVENT
        packet[1] = (byte) action;
        writeLong(packet, 2, POINTER_ID_GENERIC_FINGER);
        writeInt(packet, 10, x);
        writeInt(packet, 14, y);
        writeShort(packet, 18, Math.max(1, width));
        writeShort(packet, 20, Math.max(1, height));
        writeShort(packet, 22, action == 0 || action == 2 ? 0xFFFF : 0);
        writeInt(packet, 24, 0);
        writeInt(packet, 28, 0);
        controlOutput.write(packet);
        controlOutput.flush();
        pointerDown = action == 0 || action == 2;
    }

    void stop() {
        synchronized (lock) {
            closeLocked();
        }
    }

    private void closeLocked() {
        if (pointerDown && controlOutput != null) {
            try {
                writeTouchLocked(3, pointerX, pointerY);
            } catch (IOException ignored) {
            }
        }
        closeQuietly(videoSocket);
        closeQuietly(controlSocket);
        videoSocket = null;
        controlSocket = null;
        videoInput = null;
        streamReader = null;
        controlOutput = null;
        videoClaimed = false;
        pointerDown = false;
        if (process != null) {
            process.destroy();
            process = null;
        }
        if (logDrain != null) {
            logDrain.interrupt();
            logDrain = null;
        }
    }

    private boolean socketsReady() {
        return videoInput != null && controlOutput != null;
    }

    private boolean processAlive() {
        if (process == null) return false;
        try {
            process.exitValue();
            return false;
        } catch (IllegalThreadStateException alive) {
            return true;
        }
    }

    private void stageServer() throws Exception {
        File staged = new File(context.getCacheDir(), "scrcpy-server-" + SERVER_VERSION + ".bin");
        try (InputStream input = context.getAssets().open("scrcpy-server.bin");
             FileOutputStream output = new FileOutputStream(staged)) {
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
        String command = "cp '" + staged.getAbsolutePath() + "' '" + SERVER_PATH + "'"
                + " && chmod 0644 '" + SERVER_PATH + "'";
        Shell.Result result = Shell.runRoot(command);
        if (result.code != 0) {
            throw new IOException("无法准备 scrcpy server: " + result.output);
        }
    }

    private void drainProcessOutput() {
        lastLog = "";
        logDrain = new Thread(() -> {
            byte[] buffer = new byte[2048];
            ByteArrayOutputStream line = new ByteArrayOutputStream();
            try (InputStream input = process.getInputStream()) {
                int value;
                while ((value = input.read()) != -1) {
                    synchronized (lock) {
                        if (value == '\n') {
                            String text = line.toString("UTF-8").trim();
                            if (!text.isEmpty()) lastLog = text;
                            line.reset();
                        } else {
                            line.write(value);
                            if (line.size() > 8192) line.reset();
                        }
                    }
                }
            } catch (IOException ignored) {
            }
        }, "n1remote-scrcpy-log");
        logDrain.setDaemon(true);
        logDrain.start();
    }

    private static LocalSocket connect(String name, int timeoutMs) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        IOException last = null;
        while (System.currentTimeMillis() < deadline) {
            LocalSocket socket = new LocalSocket();
            try {
                socket.connect(new LocalSocketAddress(name, LocalSocketAddress.Namespace.ABSTRACT));
                socket.setSoTimeout(0);
                return socket;
            } catch (IOException error) {
                last = error;
                closeQuietly(socket);
                Thread.sleep(90);
            }
        }
        throw new IOException("无法连接 scrcpy 通道", last);
    }

    static String h264CodecString(Packet packet) {
        if (packet == null || packet.data == null) return "avc1.42E01E";
        byte[] data = packet.data;
        for (int i = 0; i + 3 < data.length; i++) {
            int start = -1;
            if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1) {
                start = i + 3;
            } else if (i + 4 < data.length && data[i] == 0 && data[i + 1] == 0
                    && data[i + 2] == 0 && data[i + 3] == 1) {
                start = i + 4;
            }
            if (start >= 0 && start + 2 < data.length && (data[start] & 0x1F) == 7) {
                return String.format(Locale.US, "avc1.%02X%02X%02X",
                        data[start + 1] & 0xFF,
                        data[start + 2] & 0xFF,
                        data[start + 3] & 0xFF);
            }
        }
        return "avc1.42E01E";
    }

    private static long readLong(byte[] buffer, int offset) {
        return ((long) (buffer[offset] & 0xFF) << 56)
                | ((long) (buffer[offset + 1] & 0xFF) << 48)
                | ((long) (buffer[offset + 2] & 0xFF) << 40)
                | ((long) (buffer[offset + 3] & 0xFF) << 32)
                | ((long) (buffer[offset + 4] & 0xFF) << 24)
                | ((long) (buffer[offset + 5] & 0xFF) << 16)
                | ((long) (buffer[offset + 6] & 0xFF) << 8)
                | ((long) buffer[offset + 7] & 0xFF);
    }

    private static int readInt(byte[] buffer, int offset) {
        return ((buffer[offset] & 0xFF) << 24)
                | ((buffer[offset + 1] & 0xFF) << 16)
                | ((buffer[offset + 2] & 0xFF) << 8)
                | (buffer[offset + 3] & 0xFF);
    }

    private static void writeInt(byte[] buffer, int offset, int value) {
        buffer[offset] = (byte) (value >>> 24);
        buffer[offset + 1] = (byte) (value >>> 16);
        buffer[offset + 2] = (byte) (value >>> 8);
        buffer[offset + 3] = (byte) value;
    }

    private static void writeShort(byte[] buffer, int offset, int value) {
        buffer[offset] = (byte) (value >>> 8);
        buffer[offset + 1] = (byte) value;
    }

    private static void writeLong(byte[] buffer, int offset, long value) {
        for (int i = 7; i >= 0; i--) {
            buffer[offset + i] = (byte) value;
            value >>>= 8;
        }
    }

    private static float clamp01(float value) {
        if (Float.isNaN(value)) return 0f;
        return Math.max(0f, Math.min(1f, value));
    }

    private static void closeQuietly(LocalSocket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }
}
