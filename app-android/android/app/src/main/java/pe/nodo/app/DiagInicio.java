package pe.nodo.app;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.view.Choreographer;
import android.view.FrameMetrics;
import android.view.Window;
import org.json.JSONArray;
import org.json.JSONObject;

// Diagnóstico de la pantalla de carga (APK 1.0.17, 20-oct): «se ve fluido pero aún se traba en ciertas partes».
// Mide DENTRO del celular, en cada arranque, durante la carga y 2,5 s después:
//  · tirones del hilo principal (Choreographer: dos cuadros seguidos separados por más de 34 ms),
//  · cuadros lentos con su desglose (FrameMetrics, Android 7+: animación, medida, dibujo, sync, GPU…) — ahí se ve
//    si el que frena es el dibujo de la página (el WebView dibuja en el mismo hilo de render que la animación),
//  · los momentos de la carga (página empezó / cargó, la app avisó «lista», latido, salida) y lo que marca la web.
// Se guardan los últimos 5 arranques; la app los muestra en Más → Diagnóstico de la carga (NodoNativo.diagInicio).
final class DiagInicio {
    static final String KEY = "diag_inicio";
    private static final Object LOCK = new Object();
    private static long t0;
    private static boolean activo = false;
    private static String fase = "arranque";
    private static JSONArray eventos, tirones;
    private static long ultimoCuadro = 0;
    private static int cuadros = 0, lentos = 0;
    private static HandlerThread hilo;
    private static Window.OnFrameMetricsAvailableListener escucha;

    static long ms() { return SystemClock.uptimeMillis() - t0; }

    static void empezar(Activity a, long desde) {
        synchronized (LOCK) {
            t0 = desde; activo = true; fase = "arranque";
            eventos = new JSONArray(); tirones = new JSONArray();
            ultimoCuadro = 0; cuadros = 0; lentos = 0;
        }
        marca("abre la app");
        Choreographer.getInstance().postFrameCallback(cb);
        if (Build.VERSION.SDK_INT >= 24) {
            try {
                hilo = new HandlerThread("diag-inicio"); hilo.start();
                escucha = (w, m, perdidos) -> cuadro(new FrameMetrics(m));
                a.getWindow().addOnFrameMetricsAvailableListener(escucha, new Handler(hilo.getLooper()));
            } catch (Throwable t) { marca("sin métricas de cuadros: " + t.getMessage()); }
        }
    }

    static void marca(String s) {
        synchronized (LOCK) {
            if (!activo) return;
            try { eventos.put(ms() + " ms · " + s); } catch (Throwable t) { /* nada */ }
        }
    }

    static void fase(String f) { synchronized (LOCK) { fase = f; } marca("▶ " + f); }

    private static void tiron(String texto) {
        synchronized (LOCK) {
            if (!activo || tirones.length() >= 40) return;
            tirones.put(ms() + " ms · [" + fase + "] " + texto);
        }
    }

    private static final Choreographer.FrameCallback cb = new Choreographer.FrameCallback() {
        @Override public void doFrame(long ns) {
            if (!activo) return;
            long t = ns / 1_000_000L;
            synchronized (LOCK) { cuadros++; }
            if (ultimoCuadro > 0 && t - ultimoCuadro > 34) tiron("hilo principal ocupado " + (t - ultimoCuadro) + " ms");
            ultimoCuadro = t;
            Choreographer.getInstance().postFrameCallback(this);
        }
    };

    private static void cuadro(FrameMetrics m) {
        if (Build.VERSION.SDK_INT < 24 || !activo) return;
        long total = m.getMetric(FrameMetrics.TOTAL_DURATION) / 1_000_000L;
        if (total <= 32) return;
        synchronized (LOCK) { lentos++; }
        long anim = m.getMetric(FrameMetrics.ANIMATION_DURATION) / 1_000_000L;
        long medida = m.getMetric(FrameMetrics.LAYOUT_MEASURE_DURATION) / 1_000_000L;
        long dibujo = m.getMetric(FrameMetrics.DRAW_DURATION) / 1_000_000L;
        long sync = m.getMetric(FrameMetrics.SYNC_DURATION) / 1_000_000L;
        long comandos = m.getMetric(FrameMetrics.COMMAND_ISSUE_DURATION) / 1_000_000L;
        long swap = m.getMetric(FrameMetrics.SWAP_BUFFERS_DURATION) / 1_000_000L;
        long demora = m.getMetric(FrameMetrics.UNKNOWN_DELAY_DURATION) / 1_000_000L;
        String gpu = Build.VERSION.SDK_INT >= 31 ? " gpu " + (m.getMetric(FrameMetrics.GPU_DURATION) / 1_000_000L) : "";
        boolean primero = m.getMetric(FrameMetrics.FIRST_DRAW_FRAME) == 1;
        tiron("cuadro lento " + total + " ms" + (primero ? " (PRIMER cuadro)" : "") + " = espera " + demora + " · anim " + anim
            + " · medida " + medida + " · dibujo " + dibujo + " · sync " + sync + " · render " + comandos + " · swap " + swap + gpu);
    }

    // 2,5 s después de que se fue la capa de carga: se cierra y se guarda (los últimos 5)
    static void terminar(Activity a) {
        JSONObject r = new JSONObject();
        synchronized (LOCK) {
            if (!activo) return;
            try {
                eventos.put(ms() + " ms · fin del diagnóstico");
                r.put("fecha", new java.text.SimpleDateFormat("dd/MM HH:mm:ss", java.util.Locale.US).format(new java.util.Date()));
                r.put("celular", Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE);
                r.put("cuadros", cuadros);
                r.put("lentos", lentos);
                r.put("eventos", eventos);
                r.put("tirones", tirones);
            } catch (Throwable t) { /* nada */ }
            activo = false;
        }
        try {
            if (Build.VERSION.SDK_INT >= 24 && escucha != null) a.getWindow().removeOnFrameMetricsAvailableListener(escucha);
            if (hilo != null) hilo.quitSafely();
        } catch (Throwable t) { /* nada */ }
        try {
            android.content.SharedPreferences sp = a.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
            JSONArray viejos = new JSONArray(sp.getString(KEY, "[]")), nuevos = new JSONArray();
            nuevos.put(r);
            for (int i = 0; i < viejos.length() && nuevos.length() < 5; i++) nuevos.put(viejos.get(i));
            sp.edit().putString(KEY, nuevos.toString()).apply();
        } catch (Throwable t) { /* nada */ }
    }

    static String leer(Context c) {
        return c.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE).getString(KEY, "[]");
    }
}
