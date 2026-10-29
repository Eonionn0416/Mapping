param([switch]$Once)
$ErrorActionPreference='Stop'
$base='C:\System project\QA System File uploader'
foreach($part in @('Bump','Assy')){New-Item -ItemType Directory -Force -Path (Join-Path $base ('MNT\'+$part)) | Out-Null}
$mutex=[Threading.Mutex]::new($false,'Local\QAOutlookCollector49');if(!$mutex.WaitOne(0)){exit}
function Classify($subject){
 switch -Regex ($subject.Trim()) {
 '^MNT\s+Report[_ ](?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\x27\u2019]\d{2,4}$' {return @('MNT','CPK Report')}
 '^AUSTIN WIP REPORT\s*[–-]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:?\s*\d{2}$' {return @('Austin WIP & Yield','WIP')}
 '^AUSTIN FT YIELD REPORT\s*[–-]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:?\s*\d{2}$' {return @('Austin WIP & Yield','FT Yield')}
 '^Austin Weekly Yield Report\s*\d{8}$' {return @('Austin WIP & Yield','Weekly Yield')}
 '^Weekly_MTK_SCK_FC_ASSY_YIELD_\d{4,8}$' {return @('MTK','Assy Yield')}
 '^MTK Assembly OS comparison\s*[-–]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:?\s*\d{2}$' {return @('MTK','OS')}
 '^MTK BIN INFORMATION\s*[-–]\s*\d{4}-\d{2}-\d{2}\s+\d{2}:?\s*\d{2}$' {return @('MTK','BIN')}
 }
}
function MntPart($name){if($name -match '^BUMP[-_ ]MNT'){return 'Bump'};if($name -match '^ASSY[-_ ]MNT'){return 'Assy'};return ''}
function SaveMail($mail){
 if($mail.Class -ne 43){return};$route=Classify $mail.Subject;if(!$route){return}
 if($route[0] -ne 'MNT' -and $mail.ReceivedTime -lt (Get-Date).AddDays(-30)){return}
 $received=$mail.ReceivedTime.ToString('yyyyMMdd_HHmmss');$dest=Join-Path $base ($route[0]+'\'+$route[1]+'\'+$received)
 for($i=1;$i -le $mail.Attachments.Count;$i++){
  $a=$mail.Attachments.Item($i);$name=[IO.Path]::GetFileName($a.FileName);if($name -notmatch '\.xlsx?$'){continue}
  if($route[0] -eq 'MNT'){$part=MntPart $name;if(!$part){Add-Content (Join-Path $base 'collector.log') ((Get-Date -Format o)+' SKIP MNT attachment type unknown: '+$name);continue};$dest=Join-Path $base ('MNT\'+$part)}
  New-Item -ItemType Directory -Force $dest | Out-Null
  $temp=Join-Path $dest ([guid]::NewGuid().ToString()+'.partial');try{$a.SaveAsFile($temp);$hash=(Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash;$final=Join-Path $dest $name
  if(Test-Path -LiteralPath $final){if((Get-FileHash -LiteralPath $final).Hash -eq $hash){Remove-Item -LiteralPath $temp;continue};$final=Join-Path $dest ([IO.Path]::GetFileNameWithoutExtension($name)+'_'+$hash.Substring(0,12)+[IO.Path]::GetExtension($name))}
  if(Test-Path -LiteralPath $final){if((Get-FileHash -LiteralPath $final).Hash -eq $hash){Remove-Item -LiteralPath $temp;continue}}
  Move-Item -LiteralPath $temp -Destination $final;Add-Content -LiteralPath (Join-Path $base 'collector.log') -Value ((Get-Date -Format o)+' SAVED '+$mail.Subject+' / '+$name)
  }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
 }
}
function FindAuto($folder){if($folder.Name.Trim() -in @('AUTO MAIL / PERSONAL','Automail','SCK - QSE / PQA / IT')){$folder};foreach($child in $folder.Folders){FindAuto $child}}
Add-Content -LiteralPath (Join-Path $base 'collector.log') -Value ((Get-Date -Format o)+' START v59 MNT Bump/Assy; Inbox + SCK - QSE / PQA / IT')
try{do{try{
 $app=[Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application');$ns=$app.GetNamespace('MAPI');$folders=@();foreach($store in $ns.Stores){try{$inbox=$store.GetDefaultFolder(6);$folders+=,$inbox;$folders+=@(FindAuto ($store.GetRootFolder()))}catch{}}
 foreach($folder in $folders){$items=$folder.Items.Restrict("[ReceivedTime] >= '"+(Get-Date).AddDays(-90).ToString('MM/dd/yyyy hh:mm tt',[Globalization.CultureInfo]::InvariantCulture)+"'");for($i=$items.Count;$i -ge 1;$i--){try{SaveMail $items.Item($i)}catch{Add-Content (Join-Path $base 'collector.log') ((Get-Date -Format o)+' ERROR '+$_.Exception.Message)}}}
 }catch{Add-Content (Join-Path $base 'collector.log') ((Get-Date -Format o)+' WAIT '+$_.Exception.Message)}
 if(!$Once){Start-Sleep -Seconds 60}
}while(!$Once)}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
