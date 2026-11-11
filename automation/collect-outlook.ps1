param([switch]$Once)
$ErrorActionPreference='Stop'
$base='C:\System project\QA System File uploader'
New-Item -ItemType Directory -Force -Path (Join-Path $base 'MNT PO') | Out-Null
foreach($part in @('Bump','Assy')){New-Item -ItemType Directory -Force -Path (Join-Path $base ('MNT\'+$part)) | Out-Null}
$mutex=[Threading.Mutex]::new($false,'Local\QAOutlookCollector49');if(!$mutex.WaitOne(0)){exit}
New-Item -ItemType Directory -Force -Path (Join-Path $base 'MNT Yield') | Out-Null
function Classify($subject){
 switch -Regex ($subject.Trim()) {
 '^\[\d{4}-\d{2}-\d{2}\]\s*Montage VM Yield Report$' {return @('MNT VM','VM Yield')}
 '^BDR_SCK_FC_ASSY_YIELD_\d{4}$' {return @('Austin Top7','Top 7')}

 '^Montage\s*:?\s*Weekly Yield Report for\s+\d{1,2}/\d{1,2}/\d{4}$' {return @('MNT Yield','Weekly Yield')}
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
function SenderSmtp($mail){
 try {if($mail.SenderEmailType -eq 'EX'){return $mail.Sender.GetExchangeUser().PrimarySmtpAddress.ToLower()};return $mail.SenderEmailAddress.ToLower()}catch{return ''}
}

function SaveYieldMail($mail,$kind){
 $root='C:\Users\seungeon.kim\OneDrive - 江苏长电科技股份有限公司\문서\SCK'
 $archive=Join-Path $root '[Customer] MNT\[1] Weekly\Yield report'
 $target=Join-Path $base 'Austin WIP & Yield\Top 7 defect'
 $pattern='^MNT_YLD_RPT_\d+\.CSV$'
 if($kind -eq 'MNT Yield'){$target=Join-Path $base 'MNT Yield';$pattern='^YIELD_SCMO31W_\d+\.(csv|xlsx|xls)$'}
 if($kind -eq 'Austin Top7'){$archive=Join-Path $root '[Customer] Austin\[0] Weekly\Auto mail Top7 defect';$pattern='^BDR_SCK_FC_ASSY_YIELD_\d{4}\.xlsx?$'}
 foreach($dir in @($archive,$target)){[IO.Directory]::CreateDirectory($dir)|Out-Null}
 for($i=1;$i -le $mail.Attachments.Count;$i++){
  $a=$mail.Attachments.Item($i);$name=[IO.Path]::GetFileName($a.FileName);if($name -notmatch $pattern){continue}
  $temp=Join-Path $archive ([guid]::NewGuid().ToString()+'.partial')
  try{
   $a.SaveAsFile($temp);$hash=(Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash
   foreach($dir in @($archive,$target)){
    $final=Join-Path $dir $name
    if(Test-Path -LiteralPath $final){if((Get-FileHash -LiteralPath $final).Hash -eq $hash){continue};$final=Join-Path $dir ([IO.Path]::GetFileNameWithoutExtension($name)+'_'+$hash.Substring(0,12)+[IO.Path]::GetExtension($name))}
    if(Test-Path -LiteralPath $final){if((Get-FileHash -LiteralPath $final).Hash -eq $hash){continue}}
    Copy-Item -LiteralPath $temp -Destination $final
    @{receivedAt=$mail.ReceivedTime.ToUniversalTime().ToString('o');subject=$mail.Subject} | ConvertTo-Json | Set-Content -LiteralPath ($final+'.json') -Encoding UTF8
    Add-Content -LiteralPath (Join-Path $base 'collector.log') -Value ((Get-Date -Format o)+' SAVED '+$kind+' / '+$final)
   }
  }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
 }
}

function SaveMail($mail){
 if($mail.Class -ne 43){return};$route=Classify $mail.Subject;if(!$route -and (SenderSmtp $mail) -eq 'anne.li@montage-tech.com'){$route=@('MNT PO','Orders')};if(!$route){return}
 if($route[0] -notin @('MNT','MNT PO','MNT Yield','MNT VM','Austin Top7') -and $mail.ReceivedTime -lt (Get-Date).AddDays(-30)){return}
 if($route[0] -in @('MNT Yield','MNT VM','Austin Top7')){SaveYieldMail $mail $route[0];return}
 $received=$mail.ReceivedTime.ToString('yyyyMMdd_HHmmss');$dest=Join-Path $base ($route[0]+'\'+$route[1]+'\'+$received)
 for($i=1;$i -le $mail.Attachments.Count;$i++){
  $a=$mail.Attachments.Item($i);$name=[IO.Path]::GetFileName($a.FileName);if($route[0] -eq 'MNT Yield'){if($name -notmatch '\.(csv|xlsx|xls)$'){continue};$dest=Join-Path $base 'MNT Yield'}elseif($name -notmatch '\.xlsx?$'){continue}
  if($route[0] -eq 'MNT PO' -and $name -notmatch '^[ME]PRO[-_ ]?\d.*\.xlsx?$'){continue}
  if($route[0] -eq 'MNT'){$part=MntPart $name;if(!$part){Add-Content (Join-Path $base 'collector.log') ((Get-Date -Format o)+' SKIP MNT attachment type unknown: '+$name);continue};$dest=Join-Path $base ('MNT\'+$part)}
  New-Item -ItemType Directory -Force $dest | Out-Null
  $temp=Join-Path $dest ([guid]::NewGuid().ToString()+'.partial');try{$a.SaveAsFile($temp);$hash=(Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash;$final=Join-Path $dest $name
  if(Test-Path -LiteralPath $final){if((Get-FileHash -LiteralPath $final).Hash -eq $hash){Remove-Item -LiteralPath $temp;continue};$final=Join-Path $dest ([IO.Path]::GetFileNameWithoutExtension($name)+'_'+$hash.Substring(0,12)+[IO.Path]::GetExtension($name))}
  if(Test-Path -LiteralPath $final){if((Get-FileHash -LiteralPath $final).Hash -eq $hash){Remove-Item -LiteralPath $temp;continue}}
  Move-Item -LiteralPath $temp -Destination $final;if($route[0] -eq 'MNT PO'){@{receivedAt=$mail.ReceivedTime.ToUniversalTime().ToString('o');subject=$mail.Subject;sender=(SenderSmtp $mail)} | ConvertTo-Json | Set-Content -LiteralPath ($final+'.json') -Encoding UTF8};Add-Content -LiteralPath (Join-Path $base 'collector.log') -Value ((Get-Date -Format o)+' SAVED '+$mail.Subject+' / '+$name)
  }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
 }
}
function AllFolders($folder){$folder;foreach($child in $folder.Folders){AllFolders $child}}
function FindAuto($folder){if(($folder.Name -replace '\s','') -match '^AUTOMAIL/PERSONAL\d*$' -or ($folder.Name -replace '\s','') -in @('AUTOMAIL/PERSONAL','Automail','SCK-QSE/PQA/IT','CUS-MNT(Montage)','PO')){$folder};foreach($child in $folder.Folders){FindAuto $child}}
Add-Content -LiteralPath (Join-Path $base 'collector.log') -Value ((Get-Date -Format o)+' START v99 Weekly Yield + VM + Austin Top7; AUTO MAIL numeric suffix supported')
try{do{try{
 $app=[Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application');$ns=$app.GetNamespace('MAPI');$folders=@();foreach($store in $ns.Stores){try{$inbox=$store.GetDefaultFolder(6);$folders+=,$inbox;$folders+=@(FindAuto ($store.GetRootFolder()))}catch{}}
 foreach($store in $ns.Stores){foreach($folder in @(AllFolders ($store.GetRootFolder()))){try{$poItems=$folder.Items.Restrict("[SenderEmailAddress] = 'anne.li@montage-tech.com' AND [ReceivedTime] >= '"+(Get-Date).AddDays(-90).ToString('MM/dd/yyyy hh:mm tt',[Globalization.CultureInfo]::InvariantCulture)+"'");for($j=$poItems.Count;$j -ge 1;$j--){SaveMail $poItems.Item($j)}}catch{Add-Content (Join-Path $base 'collector.log') ((Get-Date -Format o)+' PO scan: '+$folder.Name+' '+$_.Exception.Message)}}}
 foreach($folder in $folders){$items=$folder.Items.Restrict("[ReceivedTime] >= '"+(Get-Date).AddDays(-90).ToString('MM/dd/yyyy hh:mm tt',[Globalization.CultureInfo]::InvariantCulture)+"'");for($i=$items.Count;$i -ge 1;$i--){try{SaveMail $items.Item($i)}catch{Add-Content (Join-Path $base 'collector.log') ((Get-Date -Format o)+' ERROR '+$_.Exception.Message)}}}
 }catch{Add-Content (Join-Path $base 'collector.log') ((Get-Date -Format o)+' WAIT '+$_.Exception.Message)}
 if(!$Once){Start-Sleep -Seconds 60}
}while(!$Once)}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
