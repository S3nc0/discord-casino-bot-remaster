interface ImportMetaEnv {
  /** Discord application id (public). */
  readonly VITE_DISCORD_CLIENT_ID?: string;
  /** "1" boots with DiscordSDKMock and an in-memory API when there is no Discord frame. */
  readonly VITE_MOCK_DISCORD?: string;
  /** Host of the API origin, when a library builds absolute URLs that patchUrlMappings must remap. */
  readonly VITE_API_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
