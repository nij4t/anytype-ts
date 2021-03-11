import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { RouteComponentProps } from 'react-router';
import { Block, Icon, Loader } from 'ts/component';
import { commonStore, blockStore, authStore, dbStore } from 'ts/store';
import { I, C, Key, Util, DataUtil, SmileUtil, Mark, focus, keyboard, crumbs, Storage, Mapper, Action } from 'ts/lib';
import { observer } from 'mobx-react';
import { throttle } from 'lodash';

import Controls from './controls';
import EditorHeaderPage from './header/page';

interface Props extends RouteComponentProps<any> {
	dataset?: any;
	rootId: string;
	isPopup: boolean;
	onOpen?(): void;
};

const { ipcRenderer } = window.require('electron');
const Constant = require('json/constant.json');
const Errors = require('json/error.json');
const $ = require('jquery');
const THROTTLE = 20;
const fs = window.require('fs');

@observer
class EditorPage extends React.Component<Props, {}> {
	
	_isMounted: boolean = false;
	id: string = '';
	timeoutHover: number = 0;
	timeoutMove: number = 0;
	hoverId: string =  '';
	hoverPosition: number = 0;
	scrollTop: number = 0;
	uiHidden: boolean = false;
	loading: boolean = false;

	constructor (props: any) {
		super(props);
		
		this.onKeyDownBlock = this.onKeyDownBlock.bind(this);
		this.onKeyUpBlock = this.onKeyUpBlock.bind(this);
		this.onMouseMove = this.onMouseMove.bind(this);
		this.onAdd = this.onAdd.bind(this);
		this.onMenuAdd = this.onMenuAdd.bind(this);
		this.onPaste = this.onPaste.bind(this);
		this.onPrint = this.onPrint.bind(this);
		this.onLastClick = this.onLastClick.bind(this);
	};

	render () {
		if (this.loading) {
			return <Loader />;
		};
		
		const { rootId } = this.props;
		const root = blockStore.getLeaf(rootId, rootId);

		if (!root) {
			return null;
		};
		
		//const details = blockStore.getDetails(rootId, rootId);
		//const { iconEmoji, iconImage, coverType, coverId } = details;
		const childrenIds = blockStore.getChildrenIds(rootId, rootId);
		const children = blockStore.getChildren(rootId, rootId);
		const length = childrenIds.length;

		return (
			<div id="editorWrapper">
				<Controls {...this.props} readOnly={false} />
				
				<div className="editor">
					<div className="blocks">
						<Icon id="button-add" className="buttonAdd" onClick={this.onAdd} />

						<EditorHeaderPage 
							{...this.props} 
							onKeyDown={this.onKeyDownBlock}
							onKeyUp={this.onKeyUpBlock}  
							onMenuAdd={this.onMenuAdd}
							onPaste={this.onPaste}
							readOnly={false}
						/>
					
						{children.map((block: I.Block, i: number) => {
							if (block.isLayoutHeader()) {
								return null;
							};
							return (
								<Block 
									key={block.id} 
									{...this.props}
									index={i}
									block={block}
									onKeyDown={this.onKeyDownBlock}
									onKeyUp={this.onKeyUpBlock}  
									onMenuAdd={this.onMenuAdd}
									onPaste={this.onPaste}
									readOnly={root.isObjectReadOnly()}
								/>
							)
						})}
					</div>
					
					<div className="blockLast" onClick={this.onLastClick} />
				</div>
			</div>
		);
	};
	
	componentDidMount () {
		const { rootId, isPopup } = this.props;

		this._isMounted = true;
		const win = $(window);
		const namespace = isPopup ? '.popup' : '';
		
		this.unbind();
		this.open();
		
		win.on('mousemove.editor' + namespace, throttle((e: any) => { this.onMouseMove(e); }, THROTTLE));
		win.on('keydown.editor' + namespace, (e: any) => { this.onKeyDownEditor(e); });
		win.on('scroll.editor' + namespace, (e: any) => { this.onScroll(e); });
		win.on('paste.editor' + namespace, (e: any) => {
			if (!keyboard.isFocused) {
				this.onPaste(e); 
			};
		});
		win.on('focus.editor' + namespace, (e: any) => { 
			focus.apply(); 
			this.getScrollContainer().scrollTop(this.scrollTop);
		});
		
		this.resize();
		win.on('resize.editor' + namespace, (e: any) => { this.resize(); });

		Storage.set('askSurvey', 1);

		ipcRenderer.removeAllListeners('commandEditor');
		ipcRenderer.on('commandEditor', (e: any, cmd: string) => { this.onCommand(cmd); });
	};

	componentDidUpdate () {
		const { rootId } = this.props;
		const node = $(ReactDOM.findDOMNode(this));
		const resizable = node.find('.resizable');
		const check = DataUtil.checkDetails(rootId);
		
		this.open();
		
		if (this.uiHidden) {
			this.uiHide();
		};

		focus.apply();
		this.getScrollContainer().scrollTop(this.scrollTop);
		this.resize();

		if (resizable.length) {
			resizable.trigger('resizeInit');
		};
		this.resize();
	};
	
	componentWillUnmount () {
		const { isPopup, rootId, match } = this.props;

		this._isMounted = false;
		this.uiHidden = false;
		this.unbind();
	
		let close = true;
		if (isPopup && (match.params.id == rootId)) {
			close = false;
		};
		if (close) {
			window.setTimeout(() => { Action.pageClose(rootId); }, 200);
		};

		focus.clear(false);
		Storage.delete('editorId');
		ipcRenderer.removeAllListeners('commandEditor');
	};

	getScrollContainer () {
		const { isPopup } = this.props;
		return isPopup ? $('#popupEditorPage .selection') : $(window);
	};

	open (skipInit?: boolean) {
		const { rootId, onOpen, history } = this.props;
		const { breadcrumbs } = blockStore;

		// Fix editor refresh without breadcrumbs init, skipInit flag prevents recursion
		if (!breadcrumbs && !skipInit) {
			DataUtil.pageInit(() => { this.open(true); });
			return;
		};
		
		if (this.id == rootId) {
			return;
		};

		this.loading = true;
		this.forceUpdate();
		
		crumbs.addCrumbs(rootId);
		crumbs.addRecent(rootId);

		this.id = rootId;
		Storage.set('editorId', rootId);

		C.BlockOpen(this.id, (message: any) => {
			if (message.error.code) {
				if (message.error.code == Errors.Code.ANYTYPE_NEEDS_UPGRADE) {
					Util.onErrorUpdate(() => {
						history.push('/main/index');
					});
				} else {
					history.push('/main/index');
				};
				return;
			};
			
			this.loading = false;
			this.focusTitle();
			this.forceUpdate();
			this.resize();
			this.getScrollContainer().scrollTop(Storage.getScroll('editor', rootId));

			blockStore.setNumbers(rootId);

			if (onOpen) {
				onOpen();
			};
		});
	};

	onCommand (cmd: string) {
		if (keyboard.isFocused) {
			return;
		};

		const { rootId } = this.props;
		const { focused, range } = focus;

		let length = 0;
		if (focused) {
			const block = blockStore.getLeaf(rootId, focused);
			if (block) {
				length = block.getLength();
			};
		};

		switch (cmd) {
			case 'selectAll':
				if ((range.from == 0) && (range.to == length)) {
					this.onSelectAll();
				} else {
					focus.set(focused, { from: 0, to: length });
					focus.apply();
				};
				break;

			case 'search':
				this.onSearch();
				break;
		};
	};
	
	focusTitle () {
		const { rootId } = this.props;
		const block = blockStore.getLeaf(rootId, 'title');
		if (!block) {
			return;
		};

		const length = block.getLength();
		if (!length) {
			focus.set(block.id, { from: length, to: length });
			focus.apply();
		};
	};
	
	close (id: string) {
		const { isPopup, rootId } = this.props;
		if (!isPopup) {
			window.setTimeout(() => { Action.pageClose(rootId); }, 200);
		};
	};
	
	unbind () {
		const { isPopup } = this.props;
		const namespace = isPopup ? '.popup' : '';
		const events = 'keydown.editor mousemove.editor scroll.editor paste.editor resize.editor focus.editor';
		const a = events.split(' ').map((it: string) => { return it + namespace; });

		$(window).unbind(a.join(' '));
	};
	
	uiHide () {
		$('.footer').css({ opacity: 0 });
		$('#button-add').css({ opacity: 0 });
		
		this.uiHidden = true;
		
		window.clearTimeout(this.timeoutMove);
		this.timeoutMove = window.setTimeout(() => {
			$(window).unbind('mousemove.ui').on('mousemove.ui', (e: any) => { this.uiShow(); });
		}, 100);
	};

	uiShow () {
		const win = $(window);
		
		$('.footer').css({ opacity: 1 });
		$('#button-add').css({ opacity: '' });
		
		this.uiHidden = false;
		win.unbind('mousemove.ui');
	};
	
	onMouseMove (e: any) {
		if (!this._isMounted) {
			return;
		};
		
		const { rootId } = this.props;
		const root = blockStore.getLeaf(rootId, rootId);

		if (!root || root.isObjectReadOnly()) {
			return;
		};
		
		const container = $('.editor');
		if (!container.length) {
			return;
		};

		const win = $(window);
		const node = $(ReactDOM.findDOMNode(this));
		const items = node.find('.block');
		const rectContainer = (container.get(0) as Element).getBoundingClientRect() as DOMRect;
		const check = DataUtil.checkDetails(rootId);
		const st = win.scrollTop();
		const add = node.find('#button-add');
		const { pageX, pageY } = e;
		const buttonOffset = 10;

		let offset = 140;
		let hovered: any = null;
		let hoveredRect = { x: 0, y: 0, height: 0 };

		if (check.withIcon && check.withCover) {
			offset = 366;
		} else
		if (check.withIcon) {
			offset = 256;
		} else
		if (check.withCover) {
			offset = 394;
		};

		// Find hovered block by mouse coords
		items.each((i: number, item: any) => {
			let rect = item.getBoundingClientRect() as DOMRect;
			rect.y += st;

			if ((pageX >= rect.x) && (pageX <= rect.x + rect.width) && (pageY >= rect.y) && (pageY <= rect.y + rect.height)) {
				hovered = item as Element;
				hoveredRect = rect;
			};
		});
		
		if (hovered) {
			hovered = $(hovered);
			this.hoverId = hovered.data('id');
		};
		
		if (keyboard.isResizing || commonStore.menuIsOpen()) {
			hovered = null;
		};
		
		const { x, y, height } = hoveredRect;
		const out = () => {
			add.removeClass('show');
			items.removeClass('showMenu isAdding top bottom');
		};
		
		window.clearTimeout(this.timeoutHover);

		if (keyboard.isDragging) {
			out();
			
			if (hovered) {
				hovered.addClass('showMenu');
			};
			return;
		};
		
		if (hovered && (pageX >= x) && (pageX <= x + Constant.size.blockMenu) && (pageY >= offset + buttonOffset) && (pageY <= st + rectContainer.height + offset + buttonOffset)) {
			this.hoverPosition = pageY < (y + height / 2) ? I.BlockPosition.Top : I.BlockPosition.Bottom;
			
			let ax = hoveredRect.x - (rectContainer.x - Constant.size.blockMenu) + 2;
			let ay = pageY - rectContainer.y - buttonOffset - st;
			
			add.addClass('show').css({ transform: `translate3d(${ax}px,${ay}px,0px)` });
			items.addClass('showMenu').removeClass('isAdding top bottom');
			
			if (pageX <= x + 20) {
				const block = blockStore.getLeaf(rootId, this.hoverId);
				if (block && block.canCreateBlock()) {
					hovered.addClass('isAdding ' + (this.hoverPosition == I.BlockPosition.Top ? 'top' : 'bottom'));
					/*
					if (block.isTextTitle()) {
						this.hoverPosition = I.BlockPosition.Bottom;
						hovered.addClass('isAdding bottom');
					};
					*/
				};
			};
		} else {
			this.timeoutHover = window.setTimeout(out, 10);
		};
	};
	
	onKeyDownEditor (e: any) {
		const { dataset, rootId } = this.props;
		const { selection } = dataset || {};
		const { focused } = focus;

		if (keyboard.isFocused || !selection) {
			return;
		};
		
		const block = blockStore.getLeaf(rootId, focused);
		const ids = selection.get();
		const map = blockStore.getMap(rootId);
		const platform = Util.getPlatform();

		// Print
		keyboard.shortcut('ctrl+p,cmd+p', e, (pressed: string) => {
			e.preventDefault();
			this.onPrint();
		});

		// Select all
		keyboard.shortcut('ctrl+a,cmd+a', e, (pressed: string) => {
			e.preventDefault();
			this.onSelectAll();
		});

		// Copy
		keyboard.shortcut('ctrl+c, cmd+c', e, (pressed: string) => {
			this.onCopy(e, false);
		});

		// Cut
		keyboard.shortcut('ctrl+x, cmd+x', e, (pressed: string) => {
			this.onCopy(e, true);
		});

		// Undo
		keyboard.shortcut('ctrl+z, cmd+z', e, (pressed: string) => {
			e.preventDefault();
			C.BlockUndo(rootId, (message: any) => { focus.clear(true); });
		});

		// Redo
		keyboard.shortcut('ctrl+shift+z, cmd+shift+z', e, (pressed: string) => {
			e.preventDefault();
			C.BlockRedo(rootId, (message: any) => { focus.clear(true); });
		});

		// Search
		keyboard.shortcut('ctrl+f, cmd+f', e, (pressed: string) => {
			e.preventDefault();
			this.onSearch();
		});

		// History
		keyboard.shortcut('ctrl+h, cmd+y', e, (pressed: string) => {
			e.preventDefault();
			this.onHistory();
		});

		keyboard.shortcut('escape', e, (pressed: string) => {
			if (ids.length && !commonStore.menuIsOpen()) {
				selection.clear();
			};
		});

		// Mark-up
		if (ids.length) {
			let type = null;

			// Bold
			keyboard.shortcut('ctrl+b, cmd+b', e, (pressed: string) => {
				type = I.MarkType.Bold;
			});

			// Italic
			keyboard.shortcut('ctrl+i, cmd+i', e, (pressed: string) => {
				type = I.MarkType.Italic;
			});

			// Strike
			keyboard.shortcut('ctrl+shift+s, cmd+shift+s', e, (pressed: string) => {
				type = I.MarkType.Strike;
			});

			// Code
			keyboard.shortcut('ctrl+l, cmd+l', e, (pressed: string) => {
				type = I.MarkType.Code;
			});

			// Link
			keyboard.shortcut('ctrl+k, cmd+k', e, (pressed: string) => {
				type = I.MarkType.Link;
			});

			if (type !== null) {
				e.preventDefault();

				if (type == I.MarkType.Link) {
					commonStore.menuOpen('blockLink', {
						type: I.MenuType.Horizontal,
						element: '#block-' + ids[0],
						offsetY: -4,
						vertical: I.MenuDirection.Top,
						horizontal: I.MenuDirection.Center,
						data: {
							value: '',
							onChange: (param: string) => {
								C.BlockListSetTextMark(rootId, ids, { type: type, param: param, range: { from: 0, to: 0 } });
							}
						}
					});
				} else {
					C.BlockListSetTextMark(rootId, ids, { type: type, param: '', range: { from: 0, to: 0 } });
				};
			};

			// Duplicate
			keyboard.shortcut('ctrl+d, cmd+d', e, (pressed: string) => {
				e.preventDefault();
				focus.clear(true);
				C.BlockListDuplicate(rootId, ids, ids[ids.length - 1], I.BlockPosition.Bottom, (message: any) => {});
			});

			// Open action menu
			keyboard.shortcut('ctrl+/, cmd+/, ctrl+shift+/', e, (pressed: string) => {
				commonStore.menuClose('blockContext');
				window.setTimeout(() => {
					commonStore.menuOpen('blockAction', { 
						element: '#block-' + ids[0],
						offsetX: Constant.size.blockMenu,
						data: {
							blockId: ids[0],
							blockIds: ids,
							rootId: rootId,
							dataset: dataset,
						},
						onClose: () => {
							selection.clear(true);
							focus.apply();
						}
					});
				}, Constant.delay.menu);
			});
		};

		// Remove blocks
		keyboard.shortcut('backspace, delete', e, (pressed: string) => {
			e.preventDefault();
			this.blockRemove(block);
		});

		// Indent block
		keyboard.shortcut('tab, shift+tab', e, (pressed: string) => {
			e.preventDefault();
			
			if (!ids.length) {
				return;
			};

			const shift = pressed.match('shift');
			const first = blockStore.getLeaf(rootId, ids[0]);
			if (!first) {
				return;
			};

			const element = map[first.id];
			const parent = blockStore.getLeaf(rootId, element.parentId);
			const next = blockStore.getNextBlock(rootId, first.id, -1);
			const obj = shift ? parent : next;
			const canTab = obj && !first.isTextTitle() && obj.canHaveChildren() && first.isIndentable();
			
			if (canTab) {
				C.BlockListMove(rootId, rootId, ids, obj.id, (shift ? I.BlockPosition.Bottom : I.BlockPosition.Inner));
			};
		});
	};

	onKeyDownBlock (e: any, text: string, marks: I.Mark[], range: any) {
		const { dataset, rootId } = this.props;
		const { focused } = focus;
		const { selection } = dataset || {};
		const block = blockStore.getLeaf(rootId, focused);

		if (!block) {
			return;
		};
		
		const win = $(window);
		const platform = Util.getPlatform();
		const map = blockStore.getMap(rootId);
		const length = String(text || '').length;
		const menuOpen = commonStore.menuIsOpen();
		const st = win.scrollTop();
		const element = $('#block-' + block.id);
		const value = element.find('#value');

		range = range || {};

		this.uiHide();
		
		// Print or prev string
		keyboard.shortcut('ctrl+p, cmd+p', e, (pressed: string) => {
			if (platform == I.Platform.Mac) {
				if (pressed == 'cmd+p') {
					e.preventDefault();
					this.onPrint();
				};
				if (pressed == 'ctrl+p') {
					this.onArrow(Key.up, length);
				};
			} else {
				e.preventDefault();
				this.onPrint();
			};
		});

		// Next string
		if (platform == I.Platform.Mac) {
			keyboard.shortcut('ctrl+n', e, (pressed: string) => {
				this.onArrow(Key.down, length);
			});
		};

		// Select all
		if ((range.from == 0) && (range.to == length)) {
			keyboard.shortcut('ctrl+a, cmd+a', e, (pressed: string) => {
				e.preventDefault();
				this.onSelectAll();
			});
		};

		// Copy
		keyboard.shortcut('ctrl+c, cmd+c', e, (pressed: string) => {
			this.onCopy(e, false);
		});

		// Cut
		keyboard.shortcut('ctrl+x, cmd+x', e, (pressed: string) => {
			this.onCopy(e, true);
		});

		// Undo
		keyboard.shortcut('ctrl+z, cmd+z', e, (pressed: string) => {
			e.preventDefault();
			C.BlockUndo(rootId, (message: any) => { focus.clear(true); });
		});

		// Redo
		keyboard.shortcut('ctrl+shift+z, cmd+shift+z', e, (pressed: string) => {
			e.preventDefault();
			C.BlockRedo(rootId, (message: any) => { focus.clear(true); });
		});

		// Search
		keyboard.shortcut('ctrl+f, cmd+f', e, (pressed: string) => {
			e.preventDefault();
			this.onSearch();
		});

		// History
		keyboard.shortcut('ctrl+h, cmd+y', e, (pressed: string) => {
			e.preventDefault();
			this.onHistory();
		});

		// Duplicate
		keyboard.shortcut('ctrl+d, cmd+d', e, (pressed: string) => {
			e.preventDefault();
			C.BlockListDuplicate(rootId, [ focused ], focused, I.BlockPosition.Bottom, (message: any) => {
				if (message.blockIds.length) {
					focus.set(message.blockIds[message.blockIds.length - 1], { from: length, to: length });
					focus.apply();
				};
			});
		});

		// Open action menu
		keyboard.shortcut('ctrl+/, cmd+/, ctrl+shift+/', e, (pressed: string) => {
			commonStore.menuClose('blockContext');
			window.setTimeout(() => {
				commonStore.menuOpen('blockAction', { 
					element: '#block-' + focused,
					offsetX: Constant.size.blockMenu,
					data: {
						blockId: focused,
						blockIds: DataUtil.selectionGet(focused, true, this.props),
						rootId: rootId,
						dataset: dataset,
					},
					onClose: () => {
						selection.clear(true);
						focus.set(focused, range);
						focus.apply();
					}
				});
			}, Constant.delay.menu);
		});

		// Mark-up
		if (!block.isTextTitle() && range.to && (range.from != range.to)) {
			let type = null;

			// Bold
			keyboard.shortcut('ctrl+b, cmd+b', e, (pressed: string) => {
				type = I.MarkType.Bold;
			});

			// Italic
			keyboard.shortcut('ctrl+i, cmd+i', e, (pressed: string) => {
				type = I.MarkType.Italic;
			});

			// Strike
			keyboard.shortcut('ctrl+shift+s, cmd+shift+s', e, (pressed: string) => {
				type = I.MarkType.Strike;
			});

			// Link
			keyboard.shortcut('ctrl+k, cmd+k', e, (pressed: string) => {
				type = I.MarkType.Link;
			});

			// Code
			keyboard.shortcut('ctrl+l, cmd+l', e, (pressed: string) => {
				type = I.MarkType.Code;
			});

			if (type !== null) {
				e.preventDefault();

				if (type == I.MarkType.Link) {
					const mark = Mark.getInRange(marks, type, range);
					const el = $('#block-' + focused);

					let rect = Util.selectionRect();
					if (!rect.x && !rect.y && !rect.width && !rect.height) {
						rect = null;
					};

					commonStore.menuClose('blockContext');
					window.setTimeout(() => {
						commonStore.menuOpen('blockLink', {
							element: el,
							rect: rect ? { ...rect, y: rect.y + win.scrollTop() } : null,
							type: I.MenuType.Horizontal,
							offsetY: -4,
							vertical: I.MenuDirection.Top,
							horizontal: I.MenuDirection.Center,
							data: {
								value: (mark ? mark.param : ''),
								onChange: (param: string) => {
									marks = Mark.toggle(marks, { type: type, param: param, range: range });
									DataUtil.blockSetText(rootId, block, text, marks, true, () => {
										focus.apply();
									});
								}
							}
						});
					}, Constant.delay.menu);
				} else {
					marks = Mark.toggle(marks, { type: type, range: range });
					DataUtil.blockSetText(rootId, block, text, marks, true, () => {
						focus.apply();
					});
				};
			};
		};

		keyboard.shortcut('arrowup, arrowdown', e, (pressed: string) => {
			this.onArrow(pressed, length);
		});

		keyboard.shortcut('ctrl+shift+arrowup, cmd+shift+arrowup, ctrl+shift+arrowdown, cmd+shift+arrowdown', e, (pressed: string) => {
			if (menuOpen) {
				return;
			};
			
			e.preventDefault();

			const dir = pressed.match(Key.up) ? -1 : 1;
			const next = blockStore.getNextBlock(rootId, focused, dir, (item: any) => {
				return !item.isIcon() && !item.isTextTitle();
			});
			if (next) {
				C.BlockListMove(rootId, rootId, [ focused ], next.id, (dir < 0 ? I.BlockPosition.Top : I.BlockPosition.Bottom));	
			};
		});

		// Last/first block
		keyboard.shortcut('ctrl+arrowup, cmd+arrowup, ctrl+arrowdown, cmd+arrowdown', e, (pressed: string) => {
			if (menuOpen) {
				return;
			};
			
			e.preventDefault();

			const dir = pressed.match(Key.up) ? -1 : 1;
			const next = blockStore.getFirstBlock(rootId, -dir, (item: any) => { return item.isFocusable(); });
			if (!next) {
				return;
			};

			const l = next.getLength();
			focus.set(next.id, (dir < 0 ? { from: 0, to: 0 } : { from: l, to: l }));
			focus.apply();
		});

		// Expand selection
		keyboard.shortcut('shift+arrowup, shift+arrowup, shift+arrowdown, shift+arrowdown', e, (pressed: string) => {
			if (selection.get(true).length) {
				return;
			};

			const dir = pressed.match(Key.up) ? -1 : 1;
			const sRect = Util.selectionRect();
			const vRect = value.get(0).getBoundingClientRect();
			const lh = parseInt(value.css('line-height'));
			const sy = sRect.y + st;
			const vy = vRect.y + st;

			const cb = () => {
				e.preventDefault();

				focus.clear(true);
				selection.set([ focused ]);

				commonStore.menuCloseAll([ 'blockContext', 'blockAction' ]);
			};

			if ((dir < 0) && (sy - 4 <= vy)) {
				cb();
			};

			if ((dir > 0) && (sy + sRect.height + lh >= vy + vRect.height)) {
				cb();
			};
		});

		// Backspace
		keyboard.shortcut('backspace, delete', e, (pressed: string) => {
			if (block.isText()) {
				const ids = selection.get(true);
				if ((pressed == 'backspace') && !range.to) {
					ids.length ? this.blockRemove(block) : this.blockMerge(block, -1);
				};

				if ((pressed == 'delete') && (range.to == length)) {
					ids.length ? this.blockRemove(block) : this.blockMerge(block, 1);
				};
			};
			if (!block.isText() && !keyboard.isFocused) {
				this.blockRemove(block);
			};
		});

		// Tab, indent block
		keyboard.shortcut('tab, shift+tab', e, (pressed: string) => {
			e.preventDefault();
			
			const shift = pressed.match('shift');
			const element = map[block.id];
			const parent = blockStore.getLeaf(rootId, element.parentId);
			const next = blockStore.getNextBlock(rootId, block.id, -1);
			const obj = shift ? parent : next;
			const canTab = obj && !block.isTextTitle() && obj.canHaveChildren() && block.isIndentable();

			if (canTab) {
				C.BlockListMove(rootId, rootId, [ block.id ], obj.id, (shift ? I.BlockPosition.Bottom : I.BlockPosition.Inner), (message: any) => {
					focus.apply();
				});
			};
		});

		// Enter
		keyboard.shortcut('enter', e, (pressed: string) => {
			if (block.isTextCode() || (!block.isText() && keyboard.isFocused)) {
				return;
			};

			const menus = commonStore.menus;
			const menuCheck = (menus.length > 1) || ((menus.length == 1) && (menus[0].id != 'blockContext'));
			
			if (menuCheck) {
				return;
			};
			
			e.preventDefault();
			e.stopPropagation();

			let replace = (range.from == length) && (range.to == length) && block.isTextList() && !length;
			if (replace) {
				C.BlockListSetTextStyle(rootId, [ block.id ], I.TextStyle.Paragraph);
			} else {
				this.blockSplit(block, range);
			};
		});
	};
	
	onKeyUpBlock (e: any, text: string, marks: I.Mark[], range: I.TextRange) {
	};

	onArrow (pressed: string, length: number) {
		if (commonStore.menuIsOpen()) {
			return;
		};

		const { focused, range } = focus;
		const dir = pressed.match(Key.up) ? -1 : 1;

		if ((dir < 0) && range.to) {
			return;
		};

		if ((dir > 0) && (range.to != length)) {
			return;
		};

		const { rootId } = this.props;
		const next = blockStore.getNextBlock(rootId, focused, dir, (it: I.Block) => { return it.isFocusable(); });
		if (!next) {
			return;
		};

		const node = $(ReactDOM.findDOMNode(this));
		const parent = blockStore.getLeaf(rootId, next.parentId);
		const l = next.getLength();
		
		// Auto-open toggle blocks 
		if (parent && parent.isTextToggle()) {
			node.find('#block-' + parent.id).addClass('isToggled');
		};

		window.setTimeout(() => {
			focus.set(next.id, (dir > 0 ? { from: 0, to: 0 } : { from: l, to: l }));
			focus.apply();
		});
	};
	
	onSelectAll () {
		const { dataset, rootId } = this.props;
		const { selection } = dataset || {};
		const ids = blockStore.getBlocks(rootId, (it: any) => { return it.isSelectable(); }).map((it: any) => { return it.id; }); 
		
		selection.set(ids);
		commonStore.menuClose('blockContext');
	};
	
	onAdd (e: any) {
		if (!this.hoverId || (this.hoverPosition == I.BlockPosition.None)) {
			return;
		};
		
		const { rootId } = this.props;
		const block = blockStore.getLeaf(rootId, this.hoverId);
		
		if (!block || (block.isTextTitle() && (this.hoverPosition != I.BlockPosition.Bottom)) || block.isLayoutColumn() || block.isIcon()) {
			return;
		};
		
		commonStore.filterSet(0, '');
		focus.clear(true);
		
		this.blockCreate(block, this.hoverPosition, {
			type: I.BlockType.Text,
			style: I.TextStyle.Paragraph,
		}, (blockId: string) => {
			$('.placeHolder.c' + blockId).text(Constant.placeHolder.filter);
			this.onMenuAdd(blockId, '', { from: 0, to: 0 });
		});
	};
	
	onMenuAdd (id: string, text: string, range: I.TextRange) {
		const { rootId } = this.props;
		const block = blockStore.getLeaf(rootId, id);

		if (!block) {
			return;
		};

		const win = $(window);
		const el = $('#block-' + id);
		const { content } = block;
		const { marks } = content;
		const length = String(text || '').length;
		const position = length ? I.BlockPosition.Bottom : I.BlockPosition.Replace; 
		const onCommand = (message: any) => {
			focus.set(message.blockId || id, { from: length, to: length });
			focus.apply();
		};
		const close = () => {
			commonStore.menuClose('blockAdd');
		};

		let rect = Util.selectionRect();
		if (!rect.x && !rect.y && !rect.width && !rect.height) {
			rect = null;
		};

		commonStore.filterSet(range.from, '');
		commonStore.menuOpen('blockAdd', { 
			element: el,
			rect: rect ? { ...rect, y: rect.y + win.scrollTop() } : null,
			offsetX: rect ? 0 : Constant.size.blockMenu,
			offsetY: 4,
			onClose: () => {
				focus.apply();
				commonStore.filterSet(0, '');
				$('.placeHolder.c' + id).text(Constant.placeHolder.default);
			},
			data: {
				blockId: id,
				rootId: rootId,
				onSelect: (e: any, item: any) => {
					const obj = $('#menuBlockAdd');
					const block = blockStore.getLeaf(rootId, id);
					const { filter } = commonStore;

					text = Util.stringCut(text, filter.from - 1, filter.from + filter.text.length);

					const onSave = () => {
						let needClose = true;

						// Text colors
						if (item.isTextColor) {
							C.BlockListSetTextColor(rootId, [ id ], item.value, onCommand);
						} else 

						// Background colors
						if (item.isBgColor) {
							C.BlockListSetBackgroundColor(rootId, [ id ], item.value, onCommand);
						} else 

						// Actions
						if (item.isAction) {
							switch (item.key) {
								case 'download':
									Action.download(block);
									break;

								case 'move':
									needClose = false;

									commonStore.menuOpen('searchObject', { 
										element: '#menuBlockAdd #item-' + item.id,
										offsetX: obj.width(),
										offsetY: -36,
										data: { 
											type: I.NavigationType.Move, 
											rootId: rootId,
											skipId: rootId,
											blockId: id,
											blockIds: [ id ],
											position: I.BlockPosition.Bottom,
											onSelect: close,
										}, 
									});
									break;

								case 'copy':
									Action.duplicate(rootId, id, [ id ]);
									break;
								
								case 'remove':
									Action.remove(rootId, id, [ id ]);
									break;
							};
						} else

						// Align
						if (item.isAlign) {
							C.BlockListSetAlign(rootId, [ id ], item.key, onCommand);
						} else 

						// Blocks
						if (item.isBlock) {
							let param: any = {
								type: item.type,
								content: {},
							};
								
							if (item.type == I.BlockType.Text) {
								param.content.style = item.key;

								if (param.content.style == I.TextStyle.Code) {
									const lang = Storage.get('codeLang') || Constant.default.codeLang;
									param.fields = { lang: lang };
								};
							};

							if (item.type == I.BlockType.File) {
								param.content.type = item.key;
							};
							
							if (item.type == I.BlockType.Div) {
								param.content.style = item.key;
							};
							
							if (item.type == I.BlockType.Page) {
								if (item.key == 'existing') {
									needClose = false;
									commonStore.menuOpen('searchObject', { 
										element: '#menuBlockAdd #item-' + item.id,
										offsetX: obj.width(),
										offsetY: -64,
										data: { 
											type: I.NavigationType.Link, 
											rootId: rootId,
											skipId: rootId,
											blockId: block.id,
											blockIds: [ block.id ],
											position: I.BlockPosition.Bottom,
											onSelect: close,
										}, 
									});
								} else {
									const details: any = { iconEmoji: SmileUtil.random() };
									
									if (item.isObject) {
										const type = dbStore.getObjectType(item.objectTypeId);
										if (type) {
											details.type = type.id;
											details.layout = type.layout;
										};
									};

									DataUtil.pageCreate(e, rootId, block.id, details, position, (message: any) => {
										DataUtil.objectOpenPopup({ ...details, id: message.targetId });
									});
								};
							} else {
								this.blockCreate(block, position, param);
							};
						};

						if (needClose) {
							close();
						};
					};

					// Clear filter in block text
					if (block) {
						// Hack to prevent onBlur save
						$('#block-' + id + ' .value').text(text);
						DataUtil.blockSetText(rootId, block, text, marks, true, onSave);
					} else {
						onSave();
					};

				}
			}
		});
	};
	
	onScroll (e: any) {
		const { rootId } = this.props;
		const top = $(window).scrollTop();

		if (Math.abs(top - this.scrollTop) >= 10) {
			this.uiHide();
		};
		
		this.scrollTop = top;
		Storage.setScroll('editor', rootId, top);
		Util.linkPreviewHide(false);
	};
	
	onCopy (e: any, cut: boolean) {
		e.preventDefault();

		const { dataset, rootId } = this.props;
		const { selection } = dataset || {};

		let { focused, range } = focus;
		let ids = selection.get(true);
		if (!ids.length) {
			ids = [ focused ];
		};
		ids = ids.concat(this.getLayoutIds(ids));
		
		const cmd = cut ? 'BlockCut' : 'BlockCopy';
		const focusBlock = blockStore.getLeaf(rootId, focused);
		const tree = blockStore.getTree(rootId, blockStore.getBlocks(rootId));
		
		let text: string[] = [];
		let blocks = blockStore.unwrapTree(tree).filter((it: I.Block) => {
			return ids.indexOf(it.id) >= 0;
		});
		blocks = Util.arrayUniqueObjects(blocks, 'id');

		blocks.map((it: I.Block) => {
			if (it.type == I.BlockType.Text) {
				text.push(String(it.content.text || ''));
			};
		});
		
		range = Util.objectCopy(range);
		if (focusBlock) {
			range = Util.rangeFixOut(focusBlock.content.text, range);
		};
		
		const data = { 
			text: text.join('\n'), 
			html: null, 
			anytype: { 
				range: range,
				blocks: blocks, 
			}
		};
		
		const cb = (message: any) => {
			const blocks = (message.anySlot || []).map(Mapper.From.Block);

			Util.clipboardCopy({
				text: message.textSlot,
				html: message.htmlSlot,
				anytype: {
					range: range,
					blocks: blocks,
				},
			});

			if (cut) {
				commonStore.menuClose('blockContext');
				focus.set(focused, { from: range.from, to: range.from });
				focus.apply();
			};
		};
		
		Util.clipboardCopy(data, () => {
			C[cmd](rootId, blocks, range, cb);
		});
	};
	
	onPaste (e: any, force?: boolean, data?: any) {
		const { dataset, rootId } = this.props;
		const { selection } = dataset || {};
		const { focused, range } = focus;
		const { path } = authStore;
		const currentFrom = range.from;
		const currentTo = range.to;

		if (!data) {
			const cb = e.clipboardData || e.originalEvent.clipboardData;
			const items = cb.items;

			data = {
				text: String(cb.getData('text/plain') || ''),
				html: String(cb.getData('text/html') || ''),
				anytype: JSON.parse(String(cb.getData('application/json') || '{}')),
				files: [],
			};
			data.anytype.range = data.anytype.range || { from: 0, to: 0 };

			// Read files
			if (items && items.length) {
				let files = [];
				for (let item of items) {
					if (item.kind != 'file') {
						continue;
					};

					const file = item.getAsFile();
					if (file) {
						files.push(file);
					};
				};

				if (files.length) {
					commonStore.progressSet({ status: 'Processing...', current: 0, total: files.length });

					for (let file of files) {
						const dir = path + '/tmp';
						const fn = dir + '/' + file.name;
						const reader = new FileReader();

						reader.readAsBinaryString(file); 
						reader.onloadend = () => {
							try {
								fs.mkdirSync(dir);
							} catch (e) {};

							fs.writeFile(fn, reader.result, 'binary', (err: any) => {
								if (err) {
									console.error(err);
									return;
								};

								data.files.push({
									name: file.name,
									path: fn,
								});

								commonStore.progressSet({ status: 'Processing...', current: data.files.length, total: files.length });

								if (data.files.length == files.length) {
									this.onPaste(e, true, data);
								};
							});
						};
					};

					return;
				};
			};
		};

		e.preventDefault();

		const block = blockStore.getLeaf(rootId, focused);
		const length = block ? block.getLength() : 0;
		const reg = new RegExp(/^((?:https?:(?:\/\/)?)|\/\/)([^\s\/\?#]+)([^\s\?#]+)(?:\?([^#\s]*))?(?:#([^\s]*))?$/gi);
		const match = data.text.match(reg);
		const url = match && match[0];
		
		if (url && !force) {
			commonStore.menuOpen('select', { 
				element: '#block-' + focused,
				offsetX: Constant.size.blockMenu,
				offsetY: 4,
				onOpen: () => {
					if (block) {
						focus.set(block.id, { from: currentFrom, to: currentTo });
						focus.apply();
					};
				},
				data: {
					value: '',
					options: [
						{ id: 'bookmark', name: 'Create bookmark' },
						{ id: 'cancel', name: 'Dismiss' },
						//{ id: 'embed', name: 'Create embed' },
					],
					onSelect: (event: any, item: any) => {
						if (item.id == 'cancel') {
							const to = range.from + url.length;
							const value = Util.stringInsert(block.content.text, url, range.from, range.from);
							const marks = Util.objectCopy(block.content.marks);

							marks.push({
								type: I.MarkType.Link,
								range: { from: range.from, to: to },
								param: url,
							});

							DataUtil.blockSetText(rootId, block, value, marks, true, () => {
								focus.set(block.id, { from: to, to: to });
								focus.apply();
							});
						};

						if (item.id == 'bookmark') {
							C.BlockBookmarkCreateAndFetch(rootId, focused, length ? I.BlockPosition.Bottom : I.BlockPosition.Replace, url);
						};
					},
				}
			});
			return;
		};
		
		let id = '';
		let from = 0;
		let to = 0;

		C.BlockPaste(rootId, focused, range, selection.get(true), data.anytype.range.to > 0, { text: data.text, html: data.html, anytype: data.anytype.blocks, files: data.files }, (message: any) => {
			commonStore.progressSet({ status: 'Processing...', current: 1, total: 1 });

			if (message.error.code) {
				return;
			};

			if (message.isSameBlockCaret) {
				id = focused;
			} else 
			if (message.blockIds && message.blockIds.length) {
				const lastId = message.blockIds[message.blockIds.length - 1];
				const block = blockStore.getLeaf(rootId, lastId);
				if (!block) {
					return;
				};
				
				const length = block.getLength();
				
				id = block.id;
				from = length;
				to = length;
			} else 
			if (message.caretPosition >= 0) {
				id = focused;
				from = message.caretPosition;
				to = message.caretPosition;
			};
			
			this.focus(id, from, to, false);
		});
	};

	onPrint () {
		focus.clearRange(true);
		window.print();
	};

	onHistory () {
		const { rootId, history } = this.props;
		history.push('/main/history/' + rootId);
	};

	onSearch () {
		const node = $(ReactDOM.findDOMNode(this));

		window.setTimeout(() => {
			commonStore.menuOpen('searchText', {
				element: '#button-header-more',
				type: I.MenuType.Horizontal,
				horizontal: I.MenuDirection.Right,
				offsetY: 8,
				data: {
					container: node,
				},
			});
		}, Constant.delay.menu);
	};

	getLayoutIds (ids: string[]) {
		if (!ids.length) {
			return [];
		};
		
		const { rootId } = this.props;
		const map = blockStore.getMap(rootId);
		
		let ret: any[] = [];
		for (let id of ids) {
			let element = map[id];
			if (!element) {
				continue;
			};

			let parent = blockStore.getLeaf(rootId, element.parentId);
			if (!parent || !parent.isLayout() || parent.isLayoutDiv() || parent.isLayoutHeader()) {
				continue;
			};
			
			ret.push(parent.id);
			
			if (parent.isLayoutColumn()) {
				ret = ret.concat(this.getLayoutIds([ parent.id ]));
			};
		};
		
		return ret;
	};

	phraseCheck () {
		let blockCnt = Number(Storage.get('blockCnt')) || 0;
		blockCnt++;
		if (blockCnt == 10) {
			commonStore.popupOpen('settings', { 
				data: { page: 'phrase' } 
			});
		};
		if (blockCnt <= 11) {
			Storage.set('blockCnt', blockCnt);
		};
	};
	
	blockCreate (focused: I.Block, position: I.BlockPosition, param: any, callBack?: (blockId: string) => void) {
		const { rootId } = this.props;
		
		C.BlockCreate(param, rootId, (focused ? focused.id : ''), position, (message: any) => {
			this.focus(message.blockId, 0, 0, false);
			this.phraseCheck();

			if (callBack) {
				callBack(message.blockId);
			};
		});
	};
	
	blockMerge (focused: I.Block, dir: number) {
		const { rootId } = this.props;
		const next = blockStore.getNextBlock(rootId, focused.id, dir, (it: any) => {
			return it.isFocusable();
		});

		if (!next) {
			return;
		};

		let blockId = '';
		let targetId = '';
		let to = 0;
		let length = focused.getLength();

		if (dir < 0) {
			blockId = next.id;
			targetId = focused.id;
			to = next.getLength();
		} else {
			blockId = focused.id;
			targetId = next.id;
			to = length;
		};

		const cb = (message: any) => {
			if (message.error.code) {
				return;
			};

			if (next) {
				this.focus(blockId, to, to, false);
			};
		};

		if (next.isText()) {
			C.BlockMerge(rootId, blockId, targetId, cb);
		} else 
		if (!length) {
			focus.clear(true);
			C.BlockUnlink(rootId, [ focused.id ], cb);
		} else {
			C.BlockUnlink(rootId, [ next.id ], (message: any) => {
				if (message.error.code) {
					return;
				};

				const next = blockStore.getNextBlock(rootId, focused.id, -1, (it: any) => {
					return it.isFocusable();
				});
				if (next) {
					const nl = dir < 0 ? next.getLength() : 0;
					this.focus(next.id, nl, nl, false);
				};
			});
		};
	};
	
	blockSplit (focused: I.Block, range: I.TextRange) {
		const { rootId } = this.props;
		const { content } = focused;
		const isTitle = focused.isTextTitle();
		const isToggle = focused.isTextToggle();
		const isList = focused.isTextList();
		const isOpen = Storage.checkToggle(rootId, focused.id);
		const childrenIds = blockStore.getChildrenIds(rootId, focused.id);
		const length = focused.getLength();

		let style = I.TextStyle.Paragraph;
		let mode = I.BlockSplitMode.Bottom;

		if ((length && isList) || (!isTitle && ((range.from != length) || (range.to != length)))) {
			style = content.style;
		};

		if ((childrenIds.length > 0) || (isToggle && isOpen)) {
			mode = I.BlockSplitMode.Inner;
		};

		if (isToggle && isOpen) {
			style = I.TextStyle.Paragraph;
		};

		range = Util.rangeFixOut(content.text, range);
		
		C.BlockSplit(rootId, focused.id, range, style, mode, (message: any) => {
			if (message.error.code) {
				return;
			};

			this.focus(message.blockId, 0, 0, true);
			this.phraseCheck();

			if (isToggle && isOpen) {
				Storage.setToggle(rootId, message.blockId, true);
				$('#block-' + message.blockId).addClass('isToggled');
			};
		});
	};
	
	blockRemove (focused?: I.Block) {
		const { rootId, dataset } = this.props;
		const { selection } = dataset || {};

		commonStore.menuCloseAll([ 'blockAdd', 'blockAction', 'blockContext' ]);

		let next: any = null;
		let ids = selection.get();
		let blockIds = [];
		
		if (ids.length) {
			next = blockStore.getNextBlock(rootId, ids[0], -1, (it: any) => { return it.isFocusable(); });
			blockIds = ids;
		} else 
		if (focused) {
			next = blockStore.getNextBlock(rootId, focused.id, -1, (it: any) => { return it.isFocusable(); });
			blockIds = [ focused.id ];
		};

		blockIds = blockIds.filter((it: string) => {  
			let block = blockStore.getLeaf(rootId, it);
			return block && !block.isTextTitle();
		});

		focus.clear(true);
		C.BlockUnlink(rootId, blockIds, (message: any) => {
			if (message.error.code) {
				return;
			};
			
			if (next && next.isFocusable()) {
				let length = next.getLength();
				this.focus(next.id, length, length, false);
			};
		});
	};
	
	onLastClick (e: any) {
		const { rootId } = this.props;
		const root = blockStore.getLeaf(rootId, rootId);
		
		if (!root || root.isObjectSet()) {
			return;
		};

		const children = blockStore.getChildren(rootId, rootId, (it: I.Block) => { return !it.isTextTitle(); });
		const last = children[children.length - 1];
		
		let create = false;
		let length = 0;
		
		if (!last) {
			create = true;
		} else {
			if (!last.isText()) {
				create = true;
			} else {
				length = last.getLength();
				if (length) {
					create = true;
				};
			};
		};

		if (create) {
			this.blockCreate(last, I.BlockPosition.Bottom, { type: I.BlockType.Text });
		} else {
			this.focus(last.id, length, length, false);
		};
	};
	
	resize () {
		if (!this._isMounted) {
			return;
		};
		
		const { isPopup } = this.props;
		const node = $(ReactDOM.findDOMNode(this));
		const blocks = node.find('.blocks');
		const last = node.find('.blockLast');

		if (!blocks.length || !last.length) {
			return;
		};
		
		const container = this.getScrollContainer();
		const ct = isPopup ? container.offset().top : 0;
		const h = container.height();
		const height = blocks.outerHeight() + blocks.offset().top - ct;

		last.css({ height: Math.max(Constant.size.lastBlock, h - height) });
	};
	
	focus (id: string, from: number, to: number, scroll: boolean) {
		const { isPopup } = this.props;
		const container = isPopup ? $('#popupEditorPage #innerWrap .content') : $(window);

		focus.set(id, { from: from, to: to });
		focus.apply();

		if (scroll) {
			focus.scroll(container);
		};

		this.resize();
	};

};

export default EditorPage;