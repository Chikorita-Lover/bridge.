/**
 * DataStructure used by FileDisplayer.vue to load and render directories
 */
import path from 'path'
import { promises as fs } from 'fs'
import OmegaCache from '../../editor/OmegaCache'
import LightningCache from '../../editor/LightningCache'
import { JSONFileMasks } from '../../editor/JSONFileMasks'
import TabSystem from '../../TabSystem'
import { BridgeCore } from '../../bridgeCore/main'
import InformationWindow from '../Windows/Common/Information'
import uuid from 'uuid/v4'
import FileSystem from '../../FileSystem'
declare function requestIdleCallback(cb: () => void): number

export class FileExplorerStorage {
	static data: {
		other: { [x: string]: FileExplorer }
		explorer: { [x: string]: FileExplorer }
		resource_pack: { [x: string]: FileExplorer }
	} = { explorer: {}, resource_pack: {}, other: {} }

	static set(
		explorer_type: 'explorer' | 'resource_pack' | 'other',
		project: string,
		file_explorer: FileExplorer
	) {
		this.data[explorer_type][project] = file_explorer
	}

	static get(
		explorer_type: 'explorer' | 'resource_pack' | 'other',
		project: string
	) {
		return this.data[explorer_type][project]
	}
}

export class FileExplorer {
	parent: FileExplorer
	path: string
	absolute_path: string
	name: string
	is_folder?: boolean
	is_open: boolean
	children: FileExplorer[]
	is_loading = true
	loaded_children = false
	uuid = uuid()

	loading_promise: Promise<void>

	constructor(
		parent: FileExplorer,
		f_path: string,
		absolute_path: string,
		is_folder?: boolean,
		is_open = false,
		children: FileExplorer[] = []
	) {
		this.parent = parent
		this.path = f_path
		this.name = path.basename(f_path)
		this.absolute_path = absolute_path
		this.is_folder = is_folder
		this.is_open = is_open
		this.children = children

		this.loading_promise = this.init()

		if (children.length > 0) {
			this.loaded_children = true
			this.refresh()
		}
	}

	async init() {
		if (this.is_folder !== undefined) {
			this.is_loading = false

			if (!this.is_folder) this.loaded_children = true
			else requestIdleCallback(() => this.load()) //Load more files and folders during CPU idle time

			return
		}

		try {
			this.is_folder = (await fs.lstat(this.absolute_path)).isDirectory()
			this.is_loading = false
			if (this.parent) this.parent.sort()

			requestIdleCallback(() => this.load()) //Load more files and folders during CPU idle time
		} catch (e) {}
	}
	async load() {
		this.children = await Promise.all(
			(await fs.readdir(this.absolute_path)).map(
				async p =>
					new FileExplorer(
						this,
						path.join(this.path, p),
						path.join(this.absolute_path, p),
						(
							await fs.lstat(path.join(this.absolute_path, p))
						).isDirectory()
					)
			)
		)
		this.sort()
		this.loaded_children = true
		this.updateUUID()
	}
	async refresh() {
		this.children = await Promise.all(
			(await fs.readdir(this.absolute_path, { withFileTypes: true })).map(
				async p => {
					let abs_path = path.join(this.absolute_path, p.name)
					let rel_path = path.join(this.path, p.name)
					let child = this.getChild(abs_path)

					if (child) {
						if (p.isDirectory()) return await child.refresh()
						return child
					}

					return new FileExplorer(
						this,
						rel_path,
						abs_path,
						p.isDirectory()
					)
				}
			)
		)

		this.sort()
		this.updateUUID()
		return this
	}
	getChild(absolute_path: string): FileExplorer {
		for (let explorer of this.children) {
			if (absolute_path === explorer.absolute_path) return explorer
		}
	}

	updateUUID() {
		this.uuid = uuid()
	}
	sort() {
		this.children = this.children.sort((a, b) => {
			if (a.is_folder && !b.is_folder) return -1
			if (!a.is_folder && b.is_folder) return 1
			if (a.name > b.name) return 1
			if (a.name < b.name) return -1
			return 0
		})
		this.updateUUID()
	}
	find(name: string) {
		for (let c of this.children) if (c.name === name) return c
	}

	async update(absolute_path: string, f_path: string) {
		if (this.is_loading) await this.loading_promise
		const newAbsolutePath = path.join(absolute_path, this.name)
		if (!this.is_folder) {
			await Promise.all([
				OmegaCache.rename(this.absolute_path, newAbsolutePath),
				LightningCache.rename(this.absolute_path, newAbsolutePath),
				JSONFileMasks.rename(this.absolute_path, newAbsolutePath),
			])
		}

		this.absolute_path = newAbsolutePath
		this.path = path.join(f_path, this.name)

		if (!this.loaded_children && this.is_folder) await this.load()
		await Promise.all(
			this.children.map(c => c.update(this.absolute_path, this.path))
		)
		this.updateUUID()
	}
	getAllFiles(): string[] {
		if (this.name === 'cache') return []
		return this.is_folder
			? this.children
					.map(c => c.getAllFiles())
					.flat()
					.filter(c => c !== undefined)
			: [this.absolute_path]
	}

	async remove(first = true) {
		if (first)
			this.parent.children = this.parent.children.filter(c => c !== this)

		if (this.children.length > 0) {
			await Promise.all(
				this.children.map(async c => await c.remove(false))
			)
		} else {
			TabSystem.closeByPath(this.absolute_path)
			BridgeCore.onDelete(this.absolute_path)

			await Promise.all([
				OmegaCache.clear(this.absolute_path),
				LightningCache.clear(this.absolute_path),
				JSONFileMasks.delete(this.absolute_path),
			])
		}
		this.parent.updateUUID()
	}
	async duplicate(new_name: string, open = true) {
		if (this.parent.find(new_name) !== undefined)
			return new InformationWindow(
				'Error',
				`A file with the name "${new_name}" already exists`
			)
		let new_path = path.join(path.dirname(this.absolute_path), new_name)

		await Promise.all([
			OmegaCache.duplicate(this.absolute_path, new_path).catch(() => {}),
			LightningCache.duplicate(this.absolute_path, new_path),
			JSONFileMasks.duplicate(this.absolute_path, new_path),
			fs.copyFile(this.absolute_path, new_path),
		])

		this.parent.children.push(
			new FileExplorer(
				this.parent,
				path.join(this.parent.path, new_name),
				new_path,
				false
			)
		)
		if (open)
			FileSystem.open(path.join(this.parent.absolute_path, new_name))
		this.parent.updateUUID()
	}
	rename(val: string) {
		this.name = val
		this.absolute_path = path.join(this.parent.absolute_path, val)
		this.path = path.join(this.parent.path, val)
		this.updateUUID()
	}

	open() {
		this.is_open = true
		this.updateUUID()
		if (!this.loaded_children) this.load()
		return this
	}
	close() {
		this.is_open = false
		this.updateUUID()
		return this
	}
}
