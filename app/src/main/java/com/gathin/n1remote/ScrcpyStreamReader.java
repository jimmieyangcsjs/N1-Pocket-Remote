package com.gathin.n1remote;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;

/**
 * Reads the framed scrcpy 5.x video stream, including its stream and session metadata.
 *
 * <p>Session metadata is the authoritative input coordinate size. Encoders may align the
 * captured surface (the N1 uses 1920x1072 for a 1920x1080 display), and scrcpy rejects
 * positional events whose declared size does not exactly match that value.</p>
 */
final class ScrcpyStreamReader {
    static final int MAX_PACKET_SIZE = 16 * 1024 * 1024;
    private static final int H264_CODEC_ID = 0x68323634;
    private static final int SESSION_FLAG = 0x80000000;
    private static final int MAX_VIDEO_DIMENSION = 16_384;

    static final class Frame {
        final long flags;
        final byte[] data;
        final int width;
        final int height;

        Frame(long flags, byte[] data, int width, int height) {
            this.flags = flags;
            this.data = data;
            this.width = width;
            this.height = height;
        }

        boolean isKeyFrame() {
            return (flags & (1L << 61)) != 0;
        }
    }

    private final InputStream input;
    private int width;
    private int height;

    ScrcpyStreamReader(InputStream input) {
        this.input = input;
    }

    int width() {
        return width;
    }

    int height() {
        return height;
    }

    void readStreamHeader() throws IOException {
        int codecId = readInt(readFully(4), 0);
        if (codecId != H264_CODEC_ID) {
            throw new IOException("scrcpy 视频编码不是 H.264: 0x" + Integer.toHexString(codecId));
        }
        readSession(readFully(12));
    }

    Frame readFrame() throws IOException {
        byte[] header = readFully(12);
        if ((readInt(header, 0) & SESSION_FLAG) != 0) {
            readSession(header);
            header = readFully(12);
        }

        long flags = readLong(header, 0);
        int length = readInt(header, 8);
        if (length < 0 || length > MAX_PACKET_SIZE) {
            throw new IOException("scrcpy 视频包大小异常: " + length);
        }
        return new Frame(flags, readFully(length), width, height);
    }

    private void readSession(byte[] header) throws IOException {
        int newWidth = readInt(header, 4);
        int newHeight = readInt(header, 8);
        if (newWidth <= 0 || newHeight <= 0
                || newWidth > MAX_VIDEO_DIMENSION || newHeight > MAX_VIDEO_DIMENSION) {
            throw new IOException("scrcpy 视频尺寸异常: " + newWidth + "x" + newHeight);
        }
        width = newWidth;
        height = newHeight;
    }

    private byte[] readFully(int length) throws IOException {
        byte[] data = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = input.read(data, offset, length - offset);
            if (count < 0) throw new EOFException("scrcpy 视频通道已关闭");
            offset += count;
        }
        return data;
    }

    private static int readInt(byte[] buffer, int offset) {
        return ((buffer[offset] & 0xFF) << 24)
                | ((buffer[offset + 1] & 0xFF) << 16)
                | ((buffer[offset + 2] & 0xFF) << 8)
                | (buffer[offset + 3] & 0xFF);
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
}
