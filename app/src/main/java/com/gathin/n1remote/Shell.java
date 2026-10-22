package com.gathin.n1remote;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

final class Shell {
    static final class Result {
        final int code;
        final String output;

        Result(int code, String output) {
            this.code = code;
            this.output = output;
        }
    }

    private Shell() { }

    static Result run(String command) {
        Process process = null;
        try {
            process = new ProcessBuilder("su", "--context", "u:r:shell:s0", "-c", command)
                    .redirectErrorStream(true)
                    .start();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            InputStream input = process.getInputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) out.write(buffer, 0, count);
            int code = process.waitFor();
            return new Result(code, out.toString("UTF-8").trim());
        } catch (Exception e) {
            return new Result(-1, e.getClass().getSimpleName() + ": " + e.getMessage());
        } finally {
            if (process != null) process.destroy();
        }
    }

    static boolean isRoot() {
        Result result = run("id");
        return result.code == 0 && result.output.contains("uid=0");
    }
}
