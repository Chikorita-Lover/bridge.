/**
 * Trigger and react to events
 */
import uuid from 'uuid/v4'
import { IDisposable } from '../Types/disposable'

interface IEventState {
	[event: string]: {
		[uuid: string]: (...data: unknown[]) => void | Promise<unknown>
	}
}

const EventState: IEventState = {}

export async function trigger(event: string, ...data: unknown[]) {
	console.log(event, Object.keys(EventState[event] || {}))
	if (EventState[event] !== undefined)
		return await Promise.all(
			Object.values(EventState[event]).map(cb => cb(...data))
		)
}

export function on(
	event: string,
	cb: (...data: unknown[]) => void
): IDisposable {
	let eventUUID = uuid()
	if (EventState[event] === undefined) EventState[event] = {}
	EventState[event][eventUUID] = cb

	return {
		dispose() {
			delete EventState[event][eventUUID]
		},
	}
}

export function once(event: string, cb: (...data: unknown[]) => void) {
	let disposable = on(event, (...data: unknown[]) => {
		disposable.dispose()
		return cb(...data)
	})
}
