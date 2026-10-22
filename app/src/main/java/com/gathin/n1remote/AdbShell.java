package com.gathin.n1remote;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/** Minimal ADB shell client for the device's own adbd on localhost:5555. */
final class AdbShell {
    private static final Object LOCK = new Object();
    private static final int MAX_DATA = 256 * 1024;

    private static final class Packet {
        final String command;
        final int arg0;
        final int arg1;
        final byte[] payload;

        Packet(String command, int arg0, int arg1, byte[] payload) {
            this.command = command;
            this.arg0 = arg0;
            this.arg1 = arg1;
            this.payload = payload;
        }
    }

    private AdbShell() { }

    static Shell.Result run(String command) {
        synchronized (LOCK) {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", 5555), 2500);
                socket.setSoTimeout(120_000);
                InputStream in = socket.getInputStream();
                OutputStream out = socket.getOutputStream();
                send(out, "CNXN", 0x01000000, MAX_DATA,
                        "host::\0".getBytes(StandardCharsets.US_ASCII));
                boolean ready = false;
                for (int i = 0; i < 4; i++) {
                    Packet packet = read(in);
                    if ("CNXN".equals(packet.command)) {
                        ready = true;
                        break;
                    }
                    if (!"AUTH".equals(packet.command)) break;
                }
                if (!ready) return new Shell.Result(-1, "ADB authentication required");

                int localId = 1;
                send(out, "OPEN", localId, 0,
                        ("shell:" + command + "\0").getBytes(StandardCharsets.UTF_8));
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                int remoteId = 0;
                while (true) {
                    Packet packet = read(in);
                    if ("OKAY".equals(packet.command)) {
                        remoteId = packet.arg0;
                    } else if ("WRTE".equals(packet.command)) {
                        remoteId = packet.arg0;
                        output.write(packet.payload);
                        send(out, "OKAY", localId, remoteId, new byte[0]);
                    } else if ("CLSE".equals(packet.command)) {
                        if (remoteId == 0) remoteId = packet.arg0;
                        send(out, "CLSE", localId, remoteId, new byte[0]);
                        break;
                    } else if ("AUTH".equals(packet.command)) {
                        return new Shell.Result(-1, "ADB authentication required");
                    }
                }
                return new Shell.Result(0, output.toString("UTF-8"));
            } catch (Exception e) {
                return new Shell.Result(-1, e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }
    }

    private static Packet read(InputStream in) throws Exception {
        byte[] header = new byte[24];
        readFully(in, header, true);
        String command = new String(header, 0, 4, StandardCharsets.US_ASCII);
        int arg0 = readInt(header, 4);
        int arg1 = readInt(header, 8);
        int length = readInt(header, 12);
        if (length < 0 || length > MAX_DATA) throw new IllegalArgumentException("ADB packet too large");
        byte[] payload = new byte[length];
        readFully(in, payload, false);
        return new Packet(command, arg0, arg1, payload);
    }

    private static void send(OutputStream out, String command, int arg0, int arg1, byte[] payload)
            throws Exception {
        byte[] header = new byte[24];
        byte[] cmd = command.getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(cmd, 0, header, 0, 4);
        writeInt(header, 4, arg0);
        writeInt(header, 8, arg1);
        writeInt(header, 12, payload.length);
        writeInt(header, 16, checksum(payload));
        writeInt(header, 20, readInt(cmd, 0) ^ payload.length);
        out.write(header);
        if (payload.length > 0) out.write(payload);
        out.flush();
    }

    private static int checksum(byte[] payload) {
        int sum = 0;
        for (byte b : payload) sum += b & 0xFF;
        return sum;
    }

    private static int readInt(byte[] bytes, int offset) {
        return (bytes[offset] & 0xFF)
                | (bytes[offset + 1] & 0xFF) << 8
                | (bytes[offset + 2] & 0xFF) << 16
                | (bytes[offset + 3] & 0xFF) << 24;
    }

    private static void writeInt(byte[] bytes, int offset, int value) {
        bytes[offset] = (byte) value;
        bytes[offset + 1] = (byte) (value >>> 8);
        bytes[offset + 2] = (byte) (value >>> 16);
        bytes[offset + 3] = (byte) (value >>> 24);
    }

    private static void readFully(InputStream in, byte[] bytes, boolean first) throws Exception {
        int offset = 0;
        while (offset < bytes.length) {
            int count = in.read(bytes, offset, bytes.length - offset);
            if (count < 0) throw new EOFException(first ? "ADB handshake closed" : "ADB packet truncated");
            offset += count;
        }
    }
}
