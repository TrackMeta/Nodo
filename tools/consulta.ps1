# Consulta SQL a la base de Nodo con el token guardado en el Credential Manager («Supabase CLI:nodo»), igual que
# desplegar.ps1. Uso: powershell -File tools/consulta.ps1 archivo.sql   (OJO: corre lo que diga el archivo, también escrituras)
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
$tok = $tok.Trim()
$q = [IO.File]::ReadAllText($args[0])
$body = @{ query = $q } | ConvertTo-Json -Compress
$r = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/ahoxdyffbwjlshmdezwi/database/query" -Method Post -Headers @{ Authorization = "Bearer $tok"; "Content-Type" = "application/json" } -Body ([Text.Encoding]::UTF8.GetBytes($body))
[Console]::OutputEncoding=[Text.Encoding]::UTF8; $r | ConvertTo-Json -Depth 8
