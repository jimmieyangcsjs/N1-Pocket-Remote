package com.gathin.n1remote;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

final class RemoteServer {
    private static final Pattern PACKAGE = Pattern.compile("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+");
    private static final Pattern SCREEN_SIZE = Pattern.compile("(\\d+)x(\\d+)");
    private static final int MAX_UPLOAD = 160 * 1024 * 1024;
    private final Context context;
    private final SharedPreferences prefs;
    private final int port;
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, byte[]> assetCache = new HashMap<>();
    private volatile boolean running;
    private ServerSocket socket;
    private boolean screenKnown;
    private long screenCheckedAt;
    private int screenWidth = 1920;
    private int screenHeight = 1080;

    RemoteServer(Context context, SharedPreferences prefs, int port) {
        this.context = context;
        this.prefs = prefs;
        this.port = port;
    }

    static String ensurePin(SharedPreferences prefs) {
        String pin = prefs.getString("pin", "");
        if (pin.length() != 6) {
            pin = String.format(Locale.US, "%06d", new SecureRandom().nextInt(1_000_000));
            prefs.edit().putString("pin", pin).apply();
        }
        return pin;
    }

    static String localIpv4() {
        try {
            for (NetworkInterface net : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!net.isUp() || net.isLoopback()) continue;
                for (InetAddress address : Collections.list(net.getInetAddresses())) {
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        String ip = address.getHostAddress();
                        if (ip != null && !ip.startsWith("169.254.")) return ip;
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return "设备IP";
    }

    void start() throws IOException {
        ensurePin(prefs);
        socket = new ServerSocket();
        socket.setReuseAddress(true);
        socket.bind(new InetSocketAddress("0.0.0.0", port));
        running = true;
        Thread accept = new Thread(this::acceptLoop, "n1remote-accept");
        accept.setDaemon(true);
        accept.start();
    }

    void stop() {
        running = false;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        workers.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = socket.accept();
                workers.execute(() -> handle(client));
            } catch (IOException e) {
                if (running) {
                    try { Thread.sleep(250); } catch (InterruptedException ignored) { }
                }
            }
        }
    }

    private void handle(Socket client) {
        try (Socket c = client) {
            c.setSoTimeout(30_000);
            InputStream in = new BufferedInputStream(c.getInputStream());
            String requestLine = line(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] request = requestLine.split(" ");
            if (request.length < 2) return;
            Map<String, String> headers = new HashMap<>();
            String h;
            while ((h = line(in)) != null && !h.isEmpty()) {
                int colon = h.indexOf(':');
                if (colon > 0) headers.put(h.substring(0, colon).trim().toLowerCase(Locale.US),
                        h.substring(colon + 1).trim());
            }
            int length = 0;
            try {
                length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
            } catch (NumberFormatException ignored) {
            }
            if (length < 0 || length > MAX_UPLOAD) {
                sendJson(c.getOutputStream(), 413, error("文件过大"));
                return;
            }
            byte[] body = readExactly(in, length);
            String method = request[0].toUpperCase(Locale.US);
            String path = request[1];
            int query = path.indexOf('?');
            if (query >= 0) path = path.substring(0, query);
            if (path.startsWith("/api/")) {
                handleApi(method, path, headers, body, c.getOutputStream());
            } else {
                serveAsset(method, path, c.getOutputStream());
            }
        } catch (Exception e) {
            try {
                Socket c = client;
                if (!c.isClosed()) sendJson(c.getOutputStream(), 500, error(e.getMessage()));
            } catch (Exception ignored) {
            }
        }
    }

    private void handleApi(String method, String path, Map<String, String> headers, byte[] body,
                           OutputStream out) throws Exception {
        try {
            handleApiRequest(method, path, headers, body, out);
        } catch (Exception e) {
            sendJson(out, 400, error(e.getMessage()));
        }
    }

    private void handleApiRequest(String method, String path, Map<String, String> headers, byte[] body,
                                  OutputStream out) throws Exception {
        if ("/api/login".equals(path) && "POST".equals(method)) {
            JSONObject json = object(body);
            String supplied = json.optString("pin", "");
            if (samePin(supplied, ensurePin(prefs))) sendJson(out, 200, ok());
            else sendJson(out, 401, error("PIN 不正确"));
            return;
        }
        if (!sameToken(headers.get("x-n1-token"), ensurePin(prefs))) {
            sendJson(out, 401, error("未授权，请先输入 PIN"));
            return;
        }

        if ("/api/ping".equals(path) && "GET".equals(method)) {
            sendJson(out, 200, ok());
        } else if ("/api/status".equals(path) && "GET".equals(method)) {
            JSONObject status = ok();
            Shell.Result shell = Shell.run("id");
            status.put("ip", localIpv4());
            status.put("port", port);
            status.put("adb", shell.code == 0 && shell.output.contains("uid="));
            status.put("shell", shell.output);
            status.put("ime", ime());
            int[] screen = screenSize();
            status.put("screenWidth", screen[0]);
            status.put("screenHeight", screen[1]);
            sendJson(out, 200, status);
        } else if ("/api/pointer".equals(path) && "POST".equals(method)) {
            JSONObject command = object(body);
            PointerOverlay pointer = RemoteService.pointer();
            if (pointer == null) throw new IllegalStateException("触控指针服务未启动");
            String action = command.optString("action", "");
            if ("show".equals(action)) {
                pointer.show();
                sendPointer(out, pointer.position());
            } else if ("hide".equals(action)) {
                pointer.hide();
                sendJson(out, 200, ok());
            } else if ("move".equals(action)) {
                double dx = Math.max(-0.16, Math.min(0.16, command.optDouble("dx", 0)));
                double dy = Math.max(-0.16, Math.min(0.16, command.optDouble("dy", 0)));
                pointer.move((float) dx, (float) dy);
                sendPointer(out, pointer.position());
            } else if ("click".equals(action) || "long".equals(action)) {
                int[] at = pointer.show();
                if (at == null) throw new IllegalStateException("触控指针不可用，请检查悬浮窗权限");
                if ("long".equals(action)) {
                    shellOrThrow("input swipe " + at[0] + " " + at[1] + " "
                            + at[0] + " " + at[1] + " 850");
                } else {
                    shellOrThrow("input tap " + at[0] + " " + at[1]);
                }
                JSONObject result = ok();
                result.put("x", at[0]);
                result.put("y", at[1]);
                result.put("screenWidth", at[2]);
                result.put("screenHeight", at[3]);
                sendJson(out, 200, result);
            } else {
                throw new IllegalArgumentException("触控指针动作无效");
            }
        } else if ("/api/apps".equals(path) && "GET".equals(method)) {
            JSONObject result = ok();
            result.put("apps", apps());
            sendJsonWithoutCaching(out, 200, result);
        } else if ("/api/launch".equals(path) && "POST".equals(method)) {
            launch(object(body).optString("package"));
            sendJson(out, 200, ok());
        } else if ("/api/key".equals(path) && "POST".equals(method)) {
            JSONObject key = object(body);
            int code = key.optInt("code", -1);
            if (code < 0 || code > 320) throw new IllegalArgumentException("按键码无效");
            PointerOverlay pointer = RemoteService.pointer();
            if (pointer != null && (code == 3 || code == 4)) pointer.hide();
            boolean longPress = key.optBoolean("long", false);
            if (!InputDaemon.key(code, longPress)) {
                shellOrThrow("input keyevent " + (longPress ? "--longpress " : "") + code);
            }
            sendJson(out, 200, ok());
        } else if ("/api/touch".equals(path) && "POST".equals(method)) {
            JSONObject touch = object(body);
            String action = touch.optString("action", "tap");
            int[] size = screenSize();
            int x = coordinate(touch.optDouble("x", -1), size[0]);
            int y = coordinate(touch.optDouble("y", -1), size[1]);
            if ("tap".equals(action)) {
                shellOrThrow("input tap " + x + " " + y);
            } else if ("long".equals(action)) {
                shellOrThrow("input swipe " + x + " " + y + " " + x + " " + y + " 850");
            } else if ("swipe".equals(action)) {
                int x2 = coordinate(touch.optDouble("x2", -1), size[0]);
                int y2 = coordinate(touch.optDouble("y2", -1), size[1]);
                int duration = Math.max(120, Math.min(2000, touch.optInt("duration", 350)));
                shellOrThrow("input swipe " + x + " " + y + " " + x2 + " " + y2 + " " + duration);
            } else {
                throw new IllegalArgumentException("触控动作无效");
            }
            sendJson(out, 200, ok());
        } else if ("/api/text".equals(path) && "POST".equals(method)) {
            String text = object(body).optString("text", "");
            JSONObject result = ok();
            if (N1RemoteIme.commit(text)) {
                result.put("mode", "ime");
            } else {
                setClipboard(text);
                shellOrThrow("input keyevent 279");
                result.put("mode", "clipboard");
            }
            sendJson(out, 200, result);
        } else if ("/api/ime".equals(path) && "POST".equals(method)) {
            String action = object(body).optString("action", "");
            if ("select".equals(action)) {
                String previous = Shell.run("settings get secure default_input_method").output;
                prefs.edit().putString("previous_ime", previous).apply();
                shellOrThrow("ime enable com.gathin.n1remote/.N1RemoteIme");
                shellOrThrow("ime set com.gathin.n1remote/.N1RemoteIme");
            } else if ("restore".equals(action)) {
                String previous = prefs.getString("previous_ime", "");
                if (!previous.isEmpty() && !"null".equals(previous)) shellOrThrow("ime set " + previous);
            } else {
                throw new IllegalArgumentException("IME 操作无效");
            }
            sendJson(out, 200, ok());
        } else if ("/api/install".equals(path) && "POST".equals(method)) {
            File apk = new File(context.getCacheDir(), "phone-upload.apk");
            try (FileOutputStream file = new FileOutputStream(apk)) {
                file.write(body);
            }
            Shell.Result result = Shell.run("pm install -r '" + apk.getAbsolutePath() + "'");
            apk.delete();
            if (result.code != 0 || !result.output.toLowerCase(Locale.US).contains("success")) {
                sendJson(out, 500, error(result.output));
            } else {
                sendJson(out, 200, ok());
            }
        } else if ("/api/uninstall".equals(path) && "POST".equals(method)) {
            String pkg = object(body).optString("package", "");
            if (!PACKAGE.matcher(pkg).matches() || "com.gathin.n1remote".equals(pkg)) {
                throw new IllegalArgumentException("包名无效");
            }
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(pkg, 0);
            if ((info.flags & ApplicationInfo.FLAG_SYSTEM) != 0) {
                throw new IllegalArgumentException("系统应用不允许直接卸载");
            }
            Shell.Result result = Shell.run("pm uninstall --user 0 " + pkg);
            if (result.code != 0 || !result.output.toLowerCase(Locale.US).contains("success")) {
                sendJson(out, 500, error(result.output));
            } else {
                sendJson(out, 200, ok());
            }
        } else if ("/api/screenshot".equals(path) && "GET".equals(method)) {
            String pathToShot = "/data/local/tmp/n1remote-shot.png";
            Shell.Result shot = Shell.run("screencap -p " + pathToShot + " && base64 " + pathToShot);
            if (shot.code != 0 || shot.output.isEmpty()) {
                throw new IllegalStateException(shot.output.isEmpty() ? "截图失败" : shot.output);
            }
            byte[] png = Base64.decode(shot.output, Base64.DEFAULT);
            JSONObject result = ok();
            result.put("image", "data:image/png;base64," +
                    Base64.encodeToString(png, Base64.NO_WRAP));
            sendJsonWithoutCaching(out, 200, result);
        } else {
            sendJson(out, 404, error("接口不存在"));
        }
    }

    private JSONArray apps() throws Exception {
        PackageManager pm = context.getPackageManager();
        Map<String, ResolveInfo> found = new LinkedHashMap<>();
        for (String category : new String[]{
                Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
            Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(category);
            for (ResolveInfo ri : pm.queryIntentActivities(intent, 0)) {
                if (ri.activityInfo == null || !ri.activityInfo.exported) continue;
                String pkg = ri.activityInfo.packageName;
                if (!pkg.equals(context.getPackageName()) && !found.containsKey(pkg)) found.put(pkg, ri);
            }
        }
        List<ResolveInfo> sorted = new ArrayList<>(found.values());
        sorted.sort((a, b) -> String.valueOf(a.loadLabel(pm))
                .compareToIgnoreCase(String.valueOf(b.loadLabel(pm))));
        JSONArray result = new JSONArray();
        for (ResolveInfo ri : sorted) {
            JSONObject app = new JSONObject();
            String pkg = ri.activityInfo.packageName;
            app.put("package", pkg);
            app.put("label", String.valueOf(ri.loadLabel(pm)));
            app.put("icon", icon(ri.loadIcon(pm)));
            ApplicationInfo info = ri.activityInfo.applicationInfo;
            app.put("system", info != null && (info.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
            result.put(app);
        }
        return result;
    }

    private String icon(Drawable drawable) {
        try {
            int width = drawable.getIntrinsicWidth();
            int height = drawable.getIntrinsicHeight();
            if (width <= 0) width = 96;
            if (height <= 0) height = 96;
            float scale = Math.min(96f / width, 96f / height);
            int scaledW = Math.max(1, Math.round(width * scale));
            int scaledH = Math.max(1, Math.round(height * scale));
            Bitmap bitmap = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            drawable.setBounds((96 - scaledW) / 2, (96 - scaledH) / 2,
                    (96 + scaledW) / 2, (96 + scaledH) / 2);
            drawable.draw(canvas);
            ByteArrayOutputStream png = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, png);
            bitmap.recycle();
            return "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    private void launch(String pkg) throws Exception {
        if (!PACKAGE.matcher(pkg).matches()) throw new IllegalArgumentException("包名无效");
        PackageManager pm = context.getPackageManager();
        Intent intent = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (intent == null) intent = pm.getLaunchIntentForPackage(pkg);
        if (intent == null) throw new IllegalArgumentException("应用没有可启动入口");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        context.startActivity(intent);
    }

    private String ime() {
        return Shell.run("settings get secure default_input_method").output;
    }

    private synchronized int[] screenSize() {
        long now = System.currentTimeMillis();
        if (screenKnown && now - screenCheckedAt < 5_000) return new int[]{screenWidth, screenHeight};
        String output = Shell.run("wm size").output;
        java.util.regex.Matcher match = SCREEN_SIZE.matcher(output);
        while (match.find()) {
            try {
                screenWidth = Integer.parseInt(match.group(1));
                screenHeight = Integer.parseInt(match.group(2));
            } catch (NumberFormatException ignored) {
            }
        }
        screenKnown = true;
        screenCheckedAt = now;
        return new int[]{screenWidth, screenHeight};
    }

    private static int coordinate(double value, int size) {
        if (value < 0 || value > 1) throw new IllegalArgumentException("触控坐标无效");
        return Math.max(1, Math.min(size - 1, Math.round((float) (value * size))));
    }

    private void setClipboard(String text) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean copied = new AtomicBoolean(false);
        main.post(() -> {
            ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("N1 Remote", text));
            copied.set(true);
            done.countDown();
        });
        done.await(2, TimeUnit.SECONDS);
        if (!copied.get()) throw new IllegalStateException("无法写入电视剪贴板");
    }

    private void shellOrThrow(String command) {
        Shell.Result result = Shell.run(command);
        if (result.code != 0) throw new IllegalStateException(result.output);
    }

    private void serveAsset(String method, String path, OutputStream out) throws IOException {
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            sendText(out, 405, "text/plain", "Method not allowed".getBytes(StandardCharsets.UTF_8));
            return;
        }
        String file = path.equals("/") ? "index.html" : path.substring(1);
        if (!file.matches("index\\.html|app\\.js|styles\\.css|manifest\\.webmanifest|sw\\.js|icon\\.png|lxgw-wenkai-screen-subset\\.woff2|OFL-LXGW-WenKai-Screen\\.txt")) {
            sendText(out, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
            return;
        }
        byte[] bytes = cachedAsset(file);
        if (bytes == null) {
            sendText(out, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
            return;
        }
        String type;
        if (file.endsWith(".html")) type = "text/html; charset=utf-8";
        else if (file.endsWith(".js")) type = "application/javascript; charset=utf-8";
        else if (file.endsWith(".css")) type = "text/css; charset=utf-8";
        else if (file.endsWith(".webmanifest")) type = "application/manifest+json; charset=utf-8";
        else if (file.endsWith(".woff2")) type = "font/woff2";
        else if (file.endsWith(".txt")) type = "text/plain; charset=utf-8";
        else type = "image/png";
        sendText(out, 200, type, "HEAD".equals(method) ? new byte[0] : bytes);
    }

    /** Static web assets never change while this process runs, so read each one once from the APK. */
    private synchronized byte[] cachedAsset(String file) {
        if (assetCache.containsKey(file)) return assetCache.get(file);
        try (InputStream input = context.getAssets().open("web/" + file)) {
            byte[] bytes = readAll(input);
            assetCache.put(file, bytes);
            return bytes;
        } catch (IOException e) {
            return null;
        }
    }

    private static JSONObject object(byte[] body) throws Exception {
        String text = new String(body, StandardCharsets.UTF_8);
        return text.isEmpty() ? new JSONObject() : new JSONObject(text);
    }

    private static JSONObject ok() throws Exception {
        return new JSONObject().put("ok", true);
    }

    private static JSONObject error(String message) throws Exception {
        return new JSONObject().put("ok", false).put("error", message == null ? "未知错误" : message);
    }

    private static void sendPointer(OutputStream out, int[] at) throws Exception {
        JSONObject result = ok();
        result.put("x", at[0]);
        result.put("y", at[1]);
        result.put("screenWidth", at[2]);
        result.put("screenHeight", at[3]);
        sendJson(out, 200, result);
    }

    private static boolean samePin(String a, String b) {
        return a != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),
                b.getBytes(StandardCharsets.UTF_8));
    }

    private static boolean sameToken(String a, String b) {
        return samePin(a, b);
    }

    private static void sendJson(OutputStream out, int code, JSONObject body) throws IOException {
        sendText(out, code, "application/json; charset=utf-8",
                body.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static void sendJsonWithoutCaching(OutputStream out, int code, JSONObject body) throws IOException {
        sendText(out, code, "application/json; charset=utf-8",
                body.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static void sendText(OutputStream stream, int code, String type, byte[] body) throws IOException {
        OutputStream out = new BufferedOutputStream(stream);
        String reason = code == 200 ? "OK" : code == 401 ? "Unauthorized" :
                code == 404 ? "Not Found" : code == 413 ? "Payload Too Large" : "Error";
        String headers = "HTTP/1.1 " + code + " " + reason + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "X-Content-Type-Options: nosniff\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int last = -1;
        int b;
        while ((b = in.read()) != -1) {
            if (last == '\r' && b == '\n') {
                byte[] bytes = line.toByteArray();
                return new String(bytes, 0, Math.max(0, bytes.length - 1), StandardCharsets.UTF_8);
            }
            line.write(b);
            last = b;
            if (line.size() > 16 * 1024) throw new IOException("HTTP 请求头过长");
        }
        return line.size() == 0 ? null : line.toString("UTF-8");
    }

    private static byte[] readExactly(InputStream in, int length) throws IOException {
        byte[] body = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = in.read(body, offset, length - offset);
            if (count < 0) throw new IOException("请求被截断");
            offset += count;
        }
        return body;
    }

    private static byte[] readAll(InputStream input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) out.write(buffer, 0, count);
        return out.toByteArray();
    }
}
