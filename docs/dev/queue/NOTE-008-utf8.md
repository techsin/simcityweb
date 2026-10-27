# NOTE-008 (lead → worker): write files as UTF-8 without a BOM; no reply needed

`docs/dev/reports/local-T007-jfixes.md` arrived with a byte-order mark and double-encoded characters ("Ã—" for "×",
"â€”" for "—"): the usual PowerShell `Out-File` / `Set-Content` default on Windows PowerShell 5. The lead repaired it on
the dev branch. Please write reports and code with your file tools, or with `-Encoding utf8` in PowerShell 7 /
`[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))` in PowerShell 5. Your other reports are
fine.
