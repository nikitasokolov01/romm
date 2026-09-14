# Romio game addon protocol, version 1

An admin creates a revocable integration in Romio Settings. The connection link is `https://host/romio/addon#<token>`: the browser omits the fragment from ordinary HTTP URLs and access logs. Paste it into the custom RomM connection form, which submits it in an authenticated request body. RomM stores it privately and uses `Authorization: Bearer <token>` for `/addon/v1/*`. This token can browse, search and acquire; it cannot read or change provider settings. It is separate from the Romio administrator token and TorBox key.

## JSON contract

- `GET /addon/v1/manifest`: `{id:'org.romio.games',version:'1.0.0',name:'Romio',systems:System[],categories:Category[],capabilities:{browser:true,native:true,metadataWrite:true},catalogReady:boolean}`.
- `GET /addon/v1/catalog?system=all&category=all&q=&offset=0`: `{items:Game[],offset:number,hasMore:boolean,total:number}`. Page size 48. Categories: `all`, `retro` (console released before 2000), `top-rated` and `award-winning` only when attributed metadata exists.
- `GET /addon/v1/games/:id`: one `Game`.
- `POST /addon/v1/games/:id/metadata`: attributed metadata `{metadataSource:httpsUrl,rating:number|null,ratingSource:string,awards:string[],coverUrl?:httpsUrl}`. The server-held integration token can write catalog metadata; the RomM UI exposes only admin-triggered provider lookups and never forwards browser-supplied scores. Scores are on a 0-100 scale. RomM uses its existing optional IGDB credentials.
- `POST /addon/v1/games/:id/sources` body `{region?:string,revision?:string,offset?:number}`: normal Romio search response `{items:Candidate[],warnings:string[],offset:number,hasMore:boolean}`. Always constrained to the server's canonical game title and console.
- `POST /addon/v1/acquisitions` body `{candidateId:string}`: `Job`.
- `GET /addon/v1/acquisitions/:id`: `Job`.
- `POST /addon/v1/acquisitions/:id/link` body `{}`: `{url:string}`. Fresh ephemeral HTTPS provider link, no persisted URL.
- `GET|HEAD /addon/v1/acquisitions/:id/download`: empty 307, never ROM bytes.

`System = {id:string,name:string,rommSlug:string,browserCore:string|null,retro:boolean}`.

`Game = {id:string,title:string,system:string,systemName:string,rommSlug:string,browserCore:string|null,sourceCount:number,coverUrl:string|null,rating:number|null,ratingSource:string|null,awards:string[],metadataSource:string|null}`. Game IDs are 64 hex SHA256 of console and normalized title; they are independent from source file IDs. Title grouping is derived from filenames until metadata is matched. Scores and awards are never inferred from filenames.

`Category = {id:string,name:string}`.

`Candidate = {id:string,title:string,system:string,region:string,revision:string,source:{infoHash:string,filePath:string,size:number,sha256:string},origin:string,provenance:string,totalSize:number,score:number,reasons:string[],cached:boolean|null,packaging?:'zip'|'7z'|'rar',cacheOnly?:boolean,contentsVerified?:false,collectionLabel?:string}`. Provider acquisition secrets are omitted. `cacheOnly && cached !== true` is unavailable for prepare. Browser/native supported packaging is independently checked.

`Job = {id:string,state:'submitting'|'reconciling'|'downloading'|'ready'|'failed',progress:number,error:string|null,updatedAt:number,candidate:Candidate}`. Both candidate and job IDs are 64 hex. Poll at 5-10 seconds. A failed or uncertain acquisition must not be silently resubmitted.

RomM should expose its own authenticated `/api/romio` counterparts. The Romio admin token never enters RomM. Local entries and existing RomM APIs retain their behavior. Direct browser playback depends on provider CORS and emulator format/core support. Native installation uses the paired loopback companion API documented in `desktop-companion/README.md`.
