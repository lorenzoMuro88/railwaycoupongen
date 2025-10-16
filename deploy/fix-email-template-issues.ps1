# Script per risolvere i problemi del template email
Write-Host "=== RISOLUZIONE PROBLEMI TEMPLATE EMAIL ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "PROBLEMA 1: Template globale (non multitenant)" -ForegroundColor Red
Write-Host "PROBLEMA 2: Nessun template di partenza per nuovi tenant" -ForegroundColor Red  
Write-Host "PROBLEMA 3: QR code non posizionato correttamente" -ForegroundColor Red
Write-Host ""
Write-Host "=== SOLUZIONI ===" -ForegroundColor Green
Write-Host ""
Write-Host "1. RENDERE IL TEMPLATE MULTITENANT:" -ForegroundColor Yellow
Write-Host "   - Aggiungere colonna tenant_id alla tabella email_template" -ForegroundColor White
Write-Host "   - Modificare le query per filtrare per tenant" -ForegroundColor White
Write-Host "   - Aggiornare gli endpoint API" -ForegroundColor White
Write-Host ""
Write-Host "2. TEMPLATE DI PARTENZA:" -ForegroundColor Yellow
Write-Host "   - Creare template default quando si crea un nuovo tenant" -ForegroundColor White
Write-Host "   - Inserire template HTML responsive di base" -ForegroundColor White
Write-Host ""
Write-Host "3. FIX QR CODE POSITIONING:" -ForegroundColor Yellow
Write-Host "   - Correggere il template HTML per posizionare correttamente il QR" -ForegroundColor White
Write-Host "   - Assicurarsi che cid:couponqr sia nel posto giusto" -ForegroundColor White
Write-Host ""
Write-Host "=== COMANDI PER FIX RAPIDO QR CODE ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Aggiorna il template con QR posizionato correttamente:" -ForegroundColor Yellow
Write-Host ""
Write-Host "docker compose exec app sh -lc \"sqlite3 data/coupons.db \"" -ForegroundColor White
Write-Host "UPDATE email_template" -ForegroundColor White
Write-Host "SET html='<!DOCTYPE html>" -ForegroundColor White
Write-Host "<html>" -ForegroundColor White
Write-Host "<head>" -ForegroundColor White
Write-Host "    <meta charset=\"utf-8\">" -ForegroundColor White
Write-Host "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" -ForegroundColor White
Write-Host "    <title>Il tuo coupon</title>" -ForegroundColor White
Write-Host "</head>" -ForegroundColor White
Write-Host "<body style=\"margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;\">" -ForegroundColor White
Write-Host "    <table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color: #f4f4f4;\">" -ForegroundColor White
Write-Host "        <tr>" -ForegroundColor White
Write-Host "            <td align=\"center\" style=\"padding: 20px 0;\">" -ForegroundColor White
Write-Host "                <table width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);\">" -ForegroundColor White
Write-Host "                    <tr>" -ForegroundColor White
Write-Host "                        <td style=\"padding: 30px; text-align: center; background-color: #2d5a3d; border-radius: 8px 8px 0 0;\">" -ForegroundColor White
Write-Host "                            <h1 style=\"color: #ffffff; margin: 0; font-size: 28px;\">🎫 Il tuo Coupon</h1>" -ForegroundColor White
Write-Host "                        </td>" -ForegroundColor White
Write-Host "                    </tr>" -ForegroundColor White
Write-Host "                    <tr>" -ForegroundColor White
Write-Host "                        <td style=\"padding: 30px;\">" -ForegroundColor White
Write-Host "                            <p style=\"font-size: 16px; color: #333333; margin: 0 0 20px 0;\">Ciao {{firstName}} {{lastName}},</p>" -ForegroundColor White
Write-Host "                            <p style=\"font-size: 16px; color: #333333; margin: 0 0 20px 0;\">Ecco il tuo coupon personale che vale <strong style=\"color: #2d5a3d;\">{{discountText}}</strong>!</p>" -ForegroundColor White
Write-Host "                            <div style=\"background-color: #f8f9fa; border: 2px dashed #2d5a3d; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;\">" -ForegroundColor White
Write-Host "                                <p style=\"font-size: 14px; color: #666666; margin: 0 0 10px 0;\">Codice Coupon</p>" -ForegroundColor White
Write-Host "                                <p style=\"font-size: 32px; font-weight: bold; color: #2d5a3d; margin: 0; letter-spacing: 2px;\">{{code}}</p>" -ForegroundColor White
Write-Host "                            </div>" -ForegroundColor White
Write-Host "                            <div style=\"text-align: center; margin: 30px 0; padding: 20px; background-color: #f8f9fa; border-radius: 8px;\">" -ForegroundColor White
Write-Host "                                <p style=\"font-size: 14px; color: #666666; margin: 0 0 15px 0;\">Scansiona il QR Code</p>" -ForegroundColor White
Write-Host "                                <img src=\"cid:couponqr\" alt=\"QR Code\" style=\"max-width: 200px; height: auto; border: 1px solid #ddd; border-radius: 8px; display: block; margin: 0 auto;\">" -ForegroundColor White
Write-Host "                            </div>" -ForegroundColor White
Write-Host "                            <p style=\"font-size: 16px; color: #333333; margin: 20px 0;\">Mostra questo codice in negozio oppure usa il link qui sotto:</p>" -ForegroundColor White
Write-Host "                            <div style=\"text-align: center; margin: 30px 0;\">" -ForegroundColor White
Write-Host "                                <a href=\"{{redemptionUrl}}\" style=\"display: inline-block; background-color: #2d5a3d; color: #ffffff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;\">🚀 Vai alla Cassa</a>" -ForegroundColor White
Write-Host "                            </div>" -ForegroundColor White
Write-Host "                            <p style=\"font-size: 14px; color: #666666; margin: 20px 0 0 0;\">Grazie per averci scelto!</p>" -ForegroundColor White
Write-Host "                        </td>" -ForegroundColor White
Write-Host "                    </tr>" -ForegroundColor White
Write-Host "                    <tr>" -ForegroundColor White
Write-Host "                        <td style=\"padding: 20px 30px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;\">" -ForegroundColor White
Write-Host "                            <p style=\"font-size: 12px; color: #999999; margin: 0;\">CouponGen - Sistema di Coupon Digitali</p>" -ForegroundColor White
Write-Host "                        </td>" -ForegroundColor White
Write-Host "                    </tr>" -ForegroundColor White
Write-Host "                </table>" -ForegroundColor White
Write-Host "            </td>" -ForegroundColor White
Write-Host "        </tr>" -ForegroundColor White
Write-Host "    </table>" -ForegroundColor White
Write-Host "</body>" -ForegroundColor White
Write-Host "</html>'," -ForegroundColor White
Write-Host "    updated_at=datetime('now')" -ForegroundColor White
Write-Host "WHERE id=1;\"" -ForegroundColor White
Write-Host ""
Write-Host "=== PROSSIMI PASSI ===" -ForegroundColor Green
Write-Host ""
Write-Host "1. Esegui il comando sopra per fixare il QR code" -ForegroundColor Yellow
Write-Host "2. Testa l'invio di un coupon" -ForegroundColor Yellow
Write-Host "3. Se funziona, implementiamo il multitenant template" -ForegroundColor Yellow
Write-Host ""
Write-Host "Vuoi che implementi subito il sistema multitenant per i template?" -ForegroundColor Cyan
