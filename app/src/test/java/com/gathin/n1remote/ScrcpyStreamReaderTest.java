package com.gathin.n1remote;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

public class ScrcpyStreamReaderTest {

    @Test
    public void reportsAlignedVideoSizeInsteadOfPhysicalScreenSize() throws Exception {
        ByteArrayOutputStream stream = new ByteArrayOutputStream();
        writeInt(stream, 0x68323634);
        writeSession(stream, 1920, 1072);
        writeFrame(stream, 0x2000000000000000L, "frame".getBytes(StandardCharsets.US_ASCII));

        ScrcpyStreamReader reader = new ScrcpyStreamReader(new ByteArrayInputStream(stream.toByteArray()));
        reader.readStreamHeader();

        assertEquals(1920, reader.width());
        assertEquals(1072, reader.height());
        ScrcpyStreamReader.Frame frame = reader.readFrame();
        assertTrue(frame.isKeyFrame());
        assertArrayEquals("frame".getBytes(StandardCharsets.US_ASCII), frame.data);
    }

    @Test
    public void followsSessionSizeWhenTheStreamChangesToFourK() throws Exception {
        ByteArrayOutputStream stream = new ByteArrayOutputStream();
        writeInt(stream, 0x68323634);
        writeSession(stream, 1920, 1072);
        writeFrame(stream, 0, new byte[]{1});
        writeSession(stream, 3840, 2160);
        writeFrame(stream, 0x2000000000000000L, new byte[]{2});

        ScrcpyStreamReader reader = new ScrcpyStreamReader(new ByteArrayInputStream(stream.toByteArray()));
        reader.readStreamHeader();
        reader.readFrame();
        ScrcpyStreamReader.Frame fourK = reader.readFrame();

        assertEquals(3840, fourK.width);
        assertEquals(2160, fourK.height);
        assertEquals(3840, reader.width());
        assertEquals(2160, reader.height());
    }

    private static void writeSession(ByteArrayOutputStream out, int width, int height) {
        writeInt(out, 0x80000000);
        writeInt(out, width);
        writeInt(out, height);
    }

    private static void writeFrame(ByteArrayOutputStream out, long flags, byte[] data) {
        writeLong(out, flags);
        writeInt(out, data.length);
        out.write(data, 0, data.length);
    }

    private static void writeInt(ByteArrayOutputStream out, int value) {
        out.write(value >>> 24);
        out.write(value >>> 16);
        out.write(value >>> 8);
        out.write(value);
    }

    private static void writeLong(ByteArrayOutputStream out, long value) {
        for (int i = 7; i >= 0; i--) {
            out.write((int) (value >>> (i * 8)));
        }
    }
}
