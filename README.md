# PartijskaBotara

Ekstenzija za **Chrome, Brave, Opera, Edge, Vivaldi** i **Firefox** koja na **X.com (Twitter)** sama pronađe naloge sa pripremljene liste i oboji ih **crvenom bojom** uz oznaku **BOT**.

Kad otvoriš X — nalozi sa liste su već obojeni. **Ne moraš ništa da klikćeš ni da podešavaš.**

---

## Šta radi

Kad se na stranici pojavi nalog sa liste, ekstenzija ga označi na **četiri mesta**:

| Gde | Kako izgleda |
|---|---|
| **Postovi (timeline)** | Crvena pozadina celog posta + `BOT` pored imena autora |
| **Predlozi naloga** („You might like") | Crvena pozadina + `BOT` |
| **Rezultati pretrage** | Crvena pozadina + `BOT` |
| **Nedavne pretrage** | Crvena pozadina + `BOT` |

Pored glavne liste postoji i **lista izuzetaka**. Ako je nalog na obe liste, **izuzetak pobeđuje** — takav nalog se **neće** obojiti.

**Lista se sama ažurira** sa GitHub-a, pa uvek imaš najnoviju verziju bez ponovne instalacije.

## Instalacija

Postupak je isti za sve browsere — razlikuje se samo adresa na koju ideš.

### Chromium browseri

| Tvoj browser | Adresa koju ukucaš |
|---|---|
| **Chrome** | `chrome://extensions` |
| **Brave** | `brave://extensions` |
| **Opera** | `opera://extensions` |
| **Edge** | `edge://extensions` |
| **Vivaldi** | `vivaldi://extensions` |

1. Ukucaj svoju adresu iz tabele i pritisni **Enter**
2. Gore desno uključi **Developer mode** (prekidač)
3. Klikni **Load unpacked** (Učitaj raspakovano)
4. Izaberi folder **`chrome-opera-brave-edge`** iz preuzetog projekta
5. Otvori [x.com](https://x.com) — to je sve ✅

> Ako ne vidiš **Load unpacked**, uveri se da je **Developer mode** uključen.

### Firefox

1. Ukucaj `about:debugging#/runtime/this-firefox` i pritisni **Enter**
2. Klikni **Load Temporary Add-on…**
3. Izaberi **`firefox/manifest.json`** (folder `firefox`, fajl `manifest.json`)
4. Otvori [x.com](https://x.com) — to je sve ✅

> ⚠️ **Važno za Firefox:** ovako učitana ekstenzija **radi samo do zatvaranja Firefox-a**. Kad ga ponovo otvoriš, moraš ponoviti korake 1–3.
>
> Razlog: Firefox traži potpisanu ekstenziju za trajnu instalaciju.

## Kako se koristi

**Ne moraš ništa da radiš.** Otvori X i skroluj — nalozi sa liste se boje sami, u roku od oko sekunde od pojavljivanja.

| Radnja | Ishod |
|---|---|
| Skroluješ timeline | Nalozi sa liste se boje čim se pojave |
| Kucaš u pretragu | Rezultati i nedavne pretrage se boje |
| Gledaš „You might like" | Predlozi se boje |
| Klikneš na ikonicu ekstenzije | Otvara se pregled liste (vidi ispod) |
| Klikneš na oznaku `BOT` | Ništa se ne dešava — oznaka je samo vizuelna |

> **Ako nalozi prestanu da se boje** posle ažuriranja ekstenzije, pritisni **F5** na X tabu.

## Pregled liste (klik na ikonicu)

Klikni na ikonicu ekstenzije u traci browsera i vidiš:

| Šta piše | Značenje |
|---|---|
| **veliki broj** | koliko naloga se **trenutno** označava |
| **Ukupno u bazi** | ukupan broj naloga na listi |
| **Izuzetaka** | koliko je naloga na listi izuzetaka |
| **Izvor** | da li je lista sa GitHub-a ili ugrađena u ekstenziju |
| **Poslednja provera / promena** | kada je lista proverena i kada je poslednji put izmenjena |

**Dugme „Ažuriraj bazu"** odmah proveri GitHub i povuče najnoviju listu. Posle toga ispiše šta se promenilo:

> **Baza ažurirana sa GitHub-a**
> Nalozi u bazi  **+12** **−3**
> Izuzeti (whitelist)  **+2** **−1**

Ako se ništa nije menjalo, piše „bez promena".

**Dugmad „Izvezi"** preuzmu trenutnu listu kao fajl u tvoj folder **Downloads** — korisno ako želiš da vidiš ili sačuvaš listu.

## Podešavanja

Otvaraš ih linkom **Podešavanja** na dnu pregleda liste (ili preko `chrome://extensions` → *Details* → **Extension options**).

| Podešavanje | Šta radi |
|---|---|
| **Boja pozadine** | Boja kojom se oboji označen nalog |
| **Tekst oznake** | Tekst pored imena (podrazumevano `BOT`) |

Ispod polja je **pregled uživo** — odmah vidiš kako će označen post izgledati.

Promena važi **odmah**, na već otvorenom X tabu — nije potrebno osvežavanje stranice.

## Ako nešto ne radi

| Problem | Rešenje |
|---|---|
| Nalozi se ne boje | Osveži stranicu (**F5**) i proveri da je ekstenzija uključena |
| Samo neki nalozi se boje | Ostali verovatno nisu na listi |
| Ne želim da vidim oznaku na nekom nalogu | Javi autoru liste da ga doda u izuzetke |
| U konzoli piše `Extension context invalidated` | Uobičajeno posle ažuriranja — **osveži stranicu (F5)** |
| Firefox: prestalo da radi posle restarta | Normalno — ponovi [Firefox korake](#firefox) |
| Ništa se ne dešava na X-u | Proveri da si na `x.com`, ne na starom `twitter.com` |
| Pregled liste piše „Repo nije podešen" | Ekstenzija nije povezana sa listom — javi autoru |
| Pregled liste piše `HTTP 404` | Fajl sa listom nije dostupan — javi autoru |
| Pregled liste piše „bez veze sa GitHub-om" | Nema interneta — koristi se ugrađena lista, detekcija radi |
| Brojevi su 0 | Klikni **Ažuriraj bazu** |

## Privatnost

- **Ništa se ne šalje na internet.** Ekstenzija ne prikuplja podatke o tebi.
- **Nema naloga, praćenja, analitike ni reklama.**
- **Ne čita tvoje postove, poruke ni profil** — samo korisnička imena iz prikaza, i to isključivo da ih uporedi sa listom.
- Poređenje se radi **lokalno**, u tvom browseru.

**Jedina mrežna aktivnost:** ekstenzija povremeno (na pokretanju browsera i svakih 6 sati) proveri da li se lista promenila na GitHub-u i, ako jeste, preuzme je. Nikakvi podaci o tebi se pri tome ne šalju.

> Lista se čuva kao kriptografski otisci (`SHA-256`), a ne kao čitljiva korisnička imena.

## Odricanje odgovornosti

- Oznaka **`BOT` je procena autora liste**, a **ne dokaz** da nalog vodi automatizovani program ili da je plaćen.
- Lista može sadržati **pogrešne unose**. Autor ne garantuje tačnost liste.
- Odgovornost za upotrebu — uključujući objavljivanje tvrdnji o označenim nalozima — snosi **isključivo korisnik**.
- Projekat **nije povezan** sa X Corp. ni sa bilo kojom političkom organizacijom.
