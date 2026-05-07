# Open Screen

Frontend statico minimale per sfogliare gli ultimi film e contenuti TV da una fonte legale pubblica e riprodurre stream compatibili con AirPlay.

## Avvio

Apri `index.html` in un browser moderno oppure servi la cartella con un server statico.

Esempio con Python:

```bash
python -m http.server 8080
```

Poi visita `http://localhost:8080`.

## Note

- Il catalogo usa l'Internet Archive e mostra gli ultimi elementi disponibili da raccolte pubbliche.
- AirPlay richiede Safari su dispositivi Apple e uno stream diretto compatibile, tipicamente `mp4` o `m3u8`.
- Non tutti gli elementi hanno un file video originale riproducibile dal browser; in quel caso resta il link alla pagina Archive.org.

## Disclaimer

This project is a personal experiment. It does not host or distribute any
media. All streaming content is fetched from third-party providers; the
legality of accessing those streams depends on your local laws. Use at
your own risk.
