# Script per aggiornare il template email con HTML completo
Write-Host "=== AGGIORNAMENTO TEMPLATE EMAIL ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Esegui questo comando sul server per aggiornare il template:" -ForegroundColor Yellow
Write-Host ""
Write-Host "docker compose exec app sh -lc \"sqlite3 data/coupons.db \"" -ForegroundColor White
Write-Host "UPDATE email_template" -ForegroundColor White
Write-Host "SET subject='Il tuo coupon'," -ForegroundColor White
Write-Host "    html='<!DOCTYPE html>" -ForegroundColor White
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
Write-Host "                            <div style=\"text-align: center; margin: 30px 0;\">" -ForegroundColor White
Write-Host "                                <img src=\"cid:couponqr\" alt=\"QR Code\" style=\"max-width: 200px; height: auto; border: 1px solid #ddd; border-radius: 8px;\">" -ForegroundColor White
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
Write-Host "WHERE id=1;\"\"" -ForegroundColor White
Write-Host ""
Write-Host "=== VERIFICA DOPO AGGIORNAMENTO ===" -ForegroundColor Green
Write-Host ""
Write-Host "1. Verifica che il template sia aggiornato:" -ForegroundColor Yellow
Write-Host "   docker compose exec app sh -lc 'sqlite3 -line data/coupons.db \"SELECT subject, length(html) FROM email_template WHERE id=1;\"'" -ForegroundColor White
Write-Host ""
Write-Host "2. Testa l'invio di un coupon dall'app" -ForegroundColor Yellow
Write-Host ""
Write-Host "3. Controlla l'email ricevuta - dovrebbe avere:" -ForegroundColor Yellow
Write-Host "   ✅ Header verde con titolo" -ForegroundColor White
Write-Host "   ✅ Codice coupon in evidenza" -ForegroundColor White
Write-Host "   ✅ QR code visibile" -ForegroundColor White
Write-Host "   ✅ Pulsante 'Vai alla Cassa'" -ForegroundColor White
Write-Host "   ✅ Footer con branding" -ForegroundColor White
