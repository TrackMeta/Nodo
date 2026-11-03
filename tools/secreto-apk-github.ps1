# Guarda en GitHub (secreto SUPABASE_SERVICE_ROLE_KEY) la llave de Supabase que usa apk.yml para subir cada APK nuevo
# al link fijo de descarga (Storage público descargas/Nodo.apk + Nodo.json con la versión). Se corre UNA vez:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Proyectos Rodrigo\Nodo\tools\secreto-apk-github.ps1"
# Lee el token de Supabase del Credential Manager (igual que desplegar.ps1) y no muestra la llave en pantalla.
$src = @"
using System;using System.Text;using System.Runtime.InteropServices;
public class CredNodoDep {
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 struct CREDENTIAL { public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
 public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
 public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
 public static string Get(string target){
 IntPtr p; if(!CredRead(target,1,0,out p)) return null;
 CREDENTIAL c=(CREDENTIAL)Marshal.PtrToStructure(p,typeof(CREDENTIAL));
 byte[] b=new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob,b,0,(int)c.CredentialBlobSize);
 if(b.Length>1 && b[1]==0) return Encoding.Unicode.GetString(b);
 return Encoding.UTF8.GetString(b);
 }
}
"@
try { Add-Type -TypeDefinition $src -Language CSharp | Out-Null } catch { }
$tok = [CredNodoDep]::Get("Supabase CLI:nodo")
if (-not $tok) { $tok = [CredNodoDep]::Get("Supabase CLI:supabase") }
if (-not $tok) { "SIN TOKEN en el Credential Manager"; exit 1 }
$keys = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/ahoxdyffbwjlshmdezwi/api-keys?reveal=true" -Headers @{ Authorization = "Bearer $tok" }
$svc = ($keys | Where-Object { $_.name -eq "service_role" } | Select-Object -First 1).api_key
if (-not $svc) { "No se encontró la llave service_role"; exit 1 }
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  $svc | gh secret set SUPABASE_SERVICE_ROLE_KEY
  if ($LASTEXITCODE -eq 0) { "LISTO: secreto SUPABASE_SERVICE_ROLE_KEY guardado en GitHub." } else { "No se pudo guardar (¿gh con sesión iniciada?)" }
} finally { Pop-Location }
