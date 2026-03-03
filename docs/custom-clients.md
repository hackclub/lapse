# Developing a Lapse custom client
The Lapse API and backend are both **client-agnostic**. This means that no special treatment is given to the **first-party** (lapse.hackclub.com) Lapse client (except when establishing an authentication authority - more on that later!)

You'll first need to register an **OAuth app** for users to authenticate to your application. You can do this by heading over to the [Developer Apps](https://lapse.hackclub.com/developer/apps) section of Lapse. We closely follow the OAuth2 specification, so you should be able to use a pre-made OAuth2 provider implementation to get access to user accounts. If you want juicy details about how we handle authentication/authorization, see [`/docs/authentication.md`](/docs/authentication.md)!

Once you're authenticated, the general timelapse creation flow looks like this:
- record a video locally, creating seperate sessions when the user changes windows or stops the stream
- call `draftTimelapse.create` - this will create the upload tokens you need to upload yer' stuff
- encrypt all sessions ([§ Encryption](#encryption)) and upload ([§ Upload](#upload)) them using the [`tus`](https://tus.io/) protocol
- potentially edit the draft, and call `timelapse.publish` with the draft ID

Do note that the raw timelapse recordings should always be in real-time, and we always transcode them on the server. For cutting out potentially sensitive information, we use the `editList` field of draft timelapses.

> [!NOTE]
> As timelapse recordings are long-running (expect 6 hours or longer worth of footage!), you are encouraged to capture your timelapses with low frame-rates and in a way which doesn't depend on **finalization** - that is, if the capture of a session stops at any time, it should be able to be submitted to the API without any further processing. We do the grunt work on the server to absolve users from taxing encoding times.

## Encryption
In order to allow different clients to handle the draft timelapses of foreign clients, we standardize the encryption used for thumbnails and video. You are required to encrypt all draft timelapse sessions and thumbnails with **AES-128** with the salts specified by the backend. All device keys are 128-bit long, and the server does **not** store them anywhere permanent.

You can reference the way the first-party client does encryption in [`/apps/client/src/encryption.ts`](/apps/client/src/encryption.ts).

## Upload
As raw timelapse videos captured by user-agent might be *very* large, and the network connections of users might be unreliable, we use the `tus` protocol for the API data plane. We chose `tus` as it has been battle-tested, is open-source, and is even [enforced by Cloudflare](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/) on their Stream service.

Everytime an endpoint needs an attachment (e.g. `draftTimelapse.create`), you'll be given **upload tokens**. These tokens tell the API _which_ resource you're actually uploading! You'll need to specify that token in the `Authorization` HTTP header for each upload. 

All `tus` uploads are handled under the `/upload` endpoint. If you're using the main Lapse API, that'll be `https://api.lapse.hackclub.com/upload`.

`tus` has plenty of [client-side implementations](https://tus.io/implementations). For our first-party web client, we use `tus-js-client`.
