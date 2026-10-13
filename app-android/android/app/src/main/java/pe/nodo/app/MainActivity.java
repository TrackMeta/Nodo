package pe.nodo.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin propio: le dice a la app web si este APK trae Firebase (sin él, registrar avisos cerraría la app).
        registerPlugin(NodoNativoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
