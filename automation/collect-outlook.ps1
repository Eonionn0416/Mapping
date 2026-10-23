param([switch]$Once)
$ErrorActionPreference='Stop'
$base='C:\System project\QA System File uploader'
$mutex=[Threading.Mutex]::new($false,'Local\QAOutlookCollector49');if(!$mutex.WaitOne(0)){exit}
function Classify($subject){
 switch -Regex ($subject.Trim()) {
 '^AUSTIN WIP REPORT\s*[–-]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:?\s*\d{2}$' {return @('Austin WIP & Yield','WIP')}
 '^AUSTIN FT YIELD REPORT\s*[–-]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:?\s*\d{2}$' {return @('Austin WIP & Yield','FT Yield')}
 '^Austin Weekly Yield Report\s*\d{8}$' {return @('Austin WIP & Yield','Weekly Yield')}
 '^Weekly_MTK_SCK_FC_ASSY_YIELD_\d{4,8}$' {return @('MTK','Assy Yield')}
 '^MTK Assembly OS comparison\s*[-–]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:?\s*\d{2}$' {return @('MTK','OS')}
 '^MTK BIN INFORMATION\s*[-–]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:?\s*\d{2}$' {return @('MTK','BIN')}
 }
}
function SaveMail($mail){
 if($mail.Class -ne 43){return};$route=Classify $mail.Subject;if(!$route){return}
 $received=$mail.ReceivedTime.ToString('yyyyMMdd_HHmmss');$dest=Join-Path $base ($route[0]+'\'+$route[1]+'\'+$received)
 for($i=1;$i -le $mail.Attachments.Count;$i++){
  $a=$mail.Attachments.Item($i);$name=[IO.Path]::GetFileName($a.FileName);if($name -notmatch '\.xlsx?$'){continue}
  New-Item -ItemType Directory -Force $dest | Out-Null
  $temp=Join-Path $dest ([guid]::NewGuid().ToString()+'.partial');try{$a.SaveAsFile($temp);$hash=(Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash;$final=Join-Path $dest $name
  if(Test-Path -LiteralPath $final){if((Get-FileHash -LiteralPath $final).Hash -eq $hash){Remove-Item -LiteralPath $temp;continue};$final=Join-Path $dest ([IO.Path]::GetFileNameWithoutExtension($name)+'_'+$hash.Substring(0,12)+[IO.Path]::GetExtension($name))}
  Move-Item -LiteralPath $temp -Destination $final;Add-Content -LiteralPath (Join-Path $base 'collector.log') -Value ((Get-Date -Format o)+' SAVED '+$mail.Subject+' / '+$name)
  }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
 }
}
function FindAuto($folder){if($folder.Name -eq 'AUTO MAIL / PERSONAL' -or $folder.Name -eq 'Automail'){return $folder};foreach($child in $folder.Folders){FindAuto $child}}
try{do{try{
 $app=[Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application');$ns=$app.GetNamespace('MAPI');$folders=@();foreach($store in $ns.Stores){try{$inbox=$store.GetDefaultFolder(6);$folders+=,$inbox;$folders+=@(FindAuto $inbox)}catch{}}
 foreach($folder in $folders){$items=$folder.Items.Restrict("[ReceivedTime] >= '"+(Get-Date).AddDays(-30).ToString('MM/dd/yyyy hh:mm tt',[Globalization.CultureInfo]::InvariantCulture)+"'");for($i=$items.Count;$i -ge 1;$i--){try{SaveMail $items.Item($i)}catch{Add-Content (Join-Path $base 'collector.log') ((Get-Date -Format o)+' ERROR '+$_.Exception.Message)}}}
 }catch{Add-Content (Join-Path $base 'collector.log') ((Get-Date -Format o)+' WAIT '+$_.Exception.Message)}
 if(!$Once){Start-Sleep -Seconds 60}
}while(!$Once)}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
