# ═══════════════════════════════════════════════════════════════════
# Conecta la base de Apps con Nodo (se corre UNA vez, después de crear el proyecto
# «Nodo Apps» en Supabase, en la MISMA organización que Nodo).
#   1. Crea las tablas (migrations/0001_base.sql).
#   2. Genera un secreto compartido y lo guarda en los dos proyectos
#      (NODO_APPS_SECRET) + la dirección de la base de Apps en Nodo (NODO_APPS_URL).
#   3. Despliega las funciones `kit` y `nodo` de la base de Apps.
#   4. Comprueba que respondan.
# Uso:  powershell -File apps-base\conectar.ps1 -Ref <ref-del-proyecto-nuevo>
# El secreto NO se muestra ni se guarda en archivos: va directo a los secretos de Supabase.
# ═══════════════════════════════════════════════════════════════════
param([Parameter(Mandatory = $true)][string]$Ref)
$ErrorActionPreference = "Stop"
$NODO = "ahoxdyffbwjlshmdezwi"
$src = @"
using System;using System.Text;using System.Runtime.InteropServices;
public class CredApps {
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 struct CREDENTIAL { public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
   public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
   public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 static extern bool CredWrite(ref CREDENTIAL cred, uint flags);
 // Guarda un token en el Administrador de credenciales de Windows (igual que cmdkey: UTF-16).
 public static bool Set(string target, string user, string secret){
   byte[] b=Encoding.Unicode.GetBytes(secret);
   CREDENTIAL c=new CREDENTIAL(); c.Type=1; c.Persist=2;
   c.TargetName=Marshal.StringToCoTaskMemUni(target); c.UserName=Marshal.StringToCoTaskMemUni(user);
   c.CredentialBlobSize=(uint)b.Length; c.CredentialBlob=Marshal.AllocCoTaskMem(b.Length); Marshal.Copy(b,0,c.CredentialBlob,b.Length);
   bool ok=CredWrite(ref c,0);
   Marshal.FreeCoTaskMem(c.TargetName); Marshal.FreeCoTaskMem(c.UserName); Marshal.FreeCoTaskMem(c.CredentialBlob);
   return ok;
 }
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
$tok = [CredApps]::Get("Supabase CLI:nodo")
if (-not $tok) { $tok = [CredApps]::Get("Supabase CLI:supabase") }
if (-not $tok) { Write-Host "No encontré el token de Supabase (Supabase CLI:nodo)." -ForegroundColor Red; exit 1 }
$tok = $tok.Trim()
# Token para el proyecto de Apps: su ranura propia («Supabase CLI:apps») si existe; si no, el de Nodo.
# (El de Nodo puede estar limitado SOLO al proyecto Nodo: entonces hace falta uno que vea el nuevo.)
$tokApps = [CredApps]::Get("Supabase CLI:apps")
# Lo guardado tiene que parecer un token (sbp_…): un intento fallido de cmdkey dejaba un carácter suelto.
if ($tokApps -and -not $tokApps.Trim().StartsWith("sbp_")) { $tokApps = $null }
if (-not $tokApps) {
  # Se pide en pantalla (sale con asteriscos, no queda en el historial) y se guarda para la próxima vez.
  Write-Host "Pega el token de Supabase que ve el proyecto nuevo (empieza con sbp_) y presiona Enter." -ForegroundColor Cyan
  Write-Host "(Si lo dejas vacío, se intenta con el token de Nodo.)" -ForegroundColor DarkGray
  $seguro = Read-Host "Token" -AsSecureString
  $plano = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
  if ($plano -and $plano.Trim()) {
    $tokApps = $plano.Trim()
    if ([CredApps]::Set("Supabase CLI:apps", "supabase", $tokApps)) { Write-Host "   Token guardado en Windows (Supabase CLI:apps)." -ForegroundColor DarkGray }
  }
  $plano = $null
}
if ($tokApps) { $tokApps = $tokApps.Trim() } else { $tokApps = $tok }
$env:SUPABASE_ACCESS_TOKEN = $tokApps
$H = @{ Authorization = "Bearer $tokApps" }

Write-Host "1/4 Revisando acceso al proyecto $Ref…"
try { Invoke-WebRequest -Uri "https://api.supabase.com/v1/projects/$Ref" -Headers $H -UseBasicParsing | Out-Null }
catch { Write-Host "El token no ve el proyecto $Ref. Crea un token en supabase.com/dashboard/account/tokens y guardalo con: cmdkey /generic:`"Supabase CLI:apps`" /user:supabase /pass:<tu token>" -ForegroundColor Red; exit 1 }

Write-Host "2/4 Creando las tablas…"
$sql = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "supabase\migrations\0001_base.sql"), (New-Object Text.UTF8Encoding $false))
$sql = ($sql -split "`n" | Where-Object { $_ -notmatch '^\s*--' }) -join "`n"
foreach ($stmt in ($sql -split ";\s*(\r?\n|$)")) {
  $s = $stmt.Trim(); if (-not $s) { continue }
  $body = [Text.Encoding]::UTF8.GetBytes((@{ query = $s } | ConvertTo-Json -Compress))
  Invoke-WebRequest -Uri "https://api.supabase.com/v1/projects/$Ref/database/query" -Method Post -Headers $H -ContentType "application/json" -Body $body -UseBasicParsing | Out-Null
}

Write-Host "3/4 Guardando el secreto compartido y desplegando…"
$secreto = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
& supabase secrets set "NODO_APPS_SECRET=$secreto" --project-ref $Ref | Out-Null
$env:SUPABASE_ACCESS_TOKEN = $tok   # los secretos de NODO van con el token de Nodo
& supabase secrets set "NODO_APPS_SECRET=$secreto" "NODO_APPS_URL=https://$Ref.supabase.co/functions/v1/nodo" --project-ref $NODO | Out-Null
$env:SUPABASE_ACCESS_TOKEN = $tokApps
Push-Location $PSScriptRoot
# El CLI escribe avisos por stderr («Docker is not running»): con Stop, PowerShell 5 los toma como error y corta.
$ErrorActionPreference = "Continue"
foreach ($f in @("kit", "nodo")) {
  $r = (& supabase functions deploy $f --project-ref $Ref --no-verify-jwt 2>&1 | Select-Object -Last 3) -join " "
  if ($r -match "Deployed Functions") { Write-Host "   OK $f" } else { Write-Host "   FALLO $f :: $r" -ForegroundColor Red }
}
Pop-Location

Write-Host "4/4 Probando…"
function Probar($url, $esperado) {
  try { $r = Invoke-WebRequest -Uri $url -Method Post -ContentType "application/json" -Body '{"app":"x"}' -UseBasicParsing; $c = $r.StatusCode }
  catch { $c = $_.Exception.Response.StatusCode.value__ }
  if ($c -eq $esperado) { Write-Host "   OK $url ($c)" } else { Write-Host "   OJO $url respondió $c (esperaba $esperado)" -ForegroundColor Yellow }
}
Probar "https://$Ref.supabase.co/functions/v1/kit" 404
Probar "https://$Ref.supabase.co/functions/v1/nodo" 403
Write-Host ""
Write-Host "Listo. Dile a Claude el ref ($Ref) para que ponga la dirección en el kit y pruebe una compra de punta a punta." -ForegroundColor Green
