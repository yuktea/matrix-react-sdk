/*
Copyright 2017 Travis Ralston
Copyright 2019, 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { MatrixClient } from "matrix-js-sdk/src/client";
import { MatrixEvent } from "matrix-js-sdk/src/models/event";
import { Room, RoomEvent } from "matrix-js-sdk/src/models/room";

import { MatrixClientPeg } from '../../MatrixClientPeg';
import MatrixClientBackedSettingsHandler from "./MatrixClientBackedSettingsHandler";
import { objectClone, objectKeyChanges } from "../../utils/objects";
import { SettingLevel } from "../SettingLevel";
import { WatchManager } from "../WatchManager";

const ALLOWED_WIDGETS_EVENT_TYPE = "im.vector.setting.allowed_widgets";

/**
 * Gets and sets settings at the "room-account" level for the current user.
 */
export default class RoomAccountSettingsHandler extends MatrixClientBackedSettingsHandler {
    constructor(public readonly watchers: WatchManager) {
        super();
    }

    protected initMatrixClient(oldClient: MatrixClient, newClient: MatrixClient) {
        if (oldClient) {
            oldClient.removeListener(RoomEvent.AccountData, this.onAccountData);
        }

        newClient.on(RoomEvent.AccountData, this.onAccountData);
    }

    private onAccountData = (event: MatrixEvent, room: Room, prevEvent: MatrixEvent) => {
        const roomId = room.roomId;

        if (event.getType() === "org.matrix.room.preview_urls") {
            let val = event.getContent()['disable'];
            if (typeof (val) !== "boolean") {
                val = null;
            } else {
                val = !val;
            }

            this.watchers.notifyUpdate("urlPreviewsEnabled", roomId, SettingLevel.ROOM_ACCOUNT, val);
        } else if (event.getType() === "im.vector.web.settings") {
            // Figure out what changed and fire those updates
            const prevContent = prevEvent ? prevEvent.getContent() : {};
            const changedSettings = objectKeyChanges<Record<string, any>>(prevContent, event.getContent());
            for (const settingName of changedSettings) {
                const val = event.getContent()[settingName];
                this.watchers.notifyUpdate(settingName, roomId, SettingLevel.ROOM_ACCOUNT, val);
            }
        } else if (event.getType() === ALLOWED_WIDGETS_EVENT_TYPE) {
            this.watchers.notifyUpdate("allowedWidgets", roomId, SettingLevel.ROOM_ACCOUNT, event.getContent());
        }
    };

    public getValue(settingName: string, roomId: string): any {
        // Special case URL previews
        if (settingName === "urlPreviewsEnabled") {
            const content = this.getSettings(roomId, "org.matrix.room.preview_urls") || {};

            // Check to make sure that we actually got a boolean
            if (typeof (content['disable']) !== "boolean") return null;
            return !content['disable'];
        }

        // Special case allowed widgets
        if (settingName === "allowedWidgets") {
            return this.getSettings(roomId, ALLOWED_WIDGETS_EVENT_TYPE);
        }

        const settings = this.getSettings(roomId) || {};
        return settings[settingName];
    }

    public async setValue(settingName: string, roomId: string, newValue: any): Promise<void> {
        // Special case URL previews
        if (settingName === "urlPreviewsEnabled") {
            const content = this.getSettings(roomId, "org.matrix.room.preview_urls") || {};
            content['disable'] = !newValue;
            await MatrixClientPeg.get().setRoomAccountData(roomId, "org.matrix.room.preview_urls", content);
            return;
        }

        // Special case allowed widgets
        if (settingName === "allowedWidgets") {
            await MatrixClientPeg.get().setRoomAccountData(roomId, ALLOWED_WIDGETS_EVENT_TYPE, newValue);
            return;
        }

        const content = this.getSettings(roomId) || {};
        content[settingName] = newValue;
        await MatrixClientPeg.get().setRoomAccountData(roomId, "im.vector.web.settings", content);
    }

    public canSetValue(settingName: string, roomId: string): boolean {
        const room = MatrixClientPeg.get().getRoom(roomId);

        // If they have the room, they can set their own account data
        return room !== undefined && room !== null;
    }

    public isSupported(): boolean {
        const cli = MatrixClientPeg.get();
        return cli !== undefined && cli !== null && !cli.isGuest();
    }

    private getSettings(roomId: string, eventType = "im.vector.web.settings"): any { // TODO: [TS] Type return
        const room = MatrixClientPeg.get().getRoom(roomId);
        if (!room) return null;

        const event = room.getAccountData(eventType);
        if (!event || !event.getContent()) return null;
        return objectClone(event.getContent()); // clone to prevent mutation
    }
}
