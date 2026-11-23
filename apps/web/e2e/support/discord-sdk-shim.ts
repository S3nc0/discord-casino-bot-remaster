// Stands in for `@discord/embedded-app-sdk` in the e2e build. The real package's own
// `DiscordSDKMock` plays the Discord client: `ready`, `authorize`, `authenticate`, locale and
// participants answer from the page's query string, so one browser context is one Discord user
// in one guild and one Activity instance. Everything past the SDK (the token exchange, HTTP,
// the websocket) is the real thing talking to a real server.
import { DiscordSDKMock, Events } from '@discord/embedded-app-sdk';

export { DiscordSDKMock, Events };

/** Mappings only matter inside Discord's proxy; the test server is reached directly. */
export function patchUrlMappings(): void {}

export class DiscordSDK extends DiscordSDKMock {
  constructor(clientId: string) {
    const query = new URLSearchParams(window.location.search);
    super(clientId || 'e2e-client', query.get('guild_id') ?? '', null, null);
    Object.assign(this, { instanceId: query.get('instance_id') ?? this.instanceId });
    const userId = query.get('e2e_user') ?? '';
    this._updateCommandMocks({
      // The fake Discord behind the server reads the code as the user's id.
      authorize: () => Promise.resolve({ code: userId }),
      userSettingsGetLocale: () => Promise.resolve({ locale: navigator.language }),
      getInstanceConnectedParticipants: () => Promise.resolve({ participants: [] }),
    });
  }
}
