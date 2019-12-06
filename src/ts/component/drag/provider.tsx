import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { DragLayer } from 'ts/component';
import { I, dispatcher } from 'ts/lib';
import { observer, inject } from 'mobx-react';
import { throttle } from 'lodash';

interface Props {
	blockStore?: any;
	dataset?: any;
	rootId: string;
};

const $ = require('jquery');
const THROTTLE = 20;

@inject('blockStore')
@observer
class DragProvider extends React.Component<Props, {}> {
	
	refLayer: any = null;
	type: string = '';
	ids: string[] = [];
	map: any;
	
	constructor (props: any) {
		super(props);
		
		this.onDragStart = this.onDragStart.bind(this);
		this.onDragMove = this.onDragMove.bind(this);
		this.onDragEnd = this.onDragEnd.bind(this);
		this.onDrop = this.onDrop.bind(this);
	};
	
	render () {
		const { rootId } = this.props;
		const children = this.injectProps(this.props.children);
		
		return (
			<React.Fragment>
				<DragLayer ref={(ref: any) => { this.refLayer = ref; }} rootId={rootId} />
				{children}
			</React.Fragment>
		);
	};
	
	onDragStart (e: any, type: string, ids: string[], component: any) {
		const { blockStore, rootId, dataset } = this.props;
		const { selection } = dataset;
		const { blocks } = blockStore;
		const win = $(window);
		
		e.stopPropagation();
		
		console.log('[onDragStart]', type, ids);
		
		this.map = blockStore.getMap(blocks[rootId]);
		this.set(type, ids);
		this.refLayer.show(type, this.ids, component);
		this.unbind();
		this.setDragImage(e);
		
		win.on('dragend.drag', (e: any) => { this.onDragEnd(e); });
		win.on('drag.drag', throttle((e: any) => { this.onDragMove(e); }, THROTTLE));
		
		if (selection) {
			selection.set(this.ids);
			selection.hide();
			selection.setBlocked(true);
		};
	};
	
	onDragMove (e: any) {
		let x = e.pageX;
		let y = e.pageY - $(window).scrollTop();
		
		this.refLayer.move(x, y);
	};
	
	onDragEnd (e: any) {
		const { dataset } = this.props;
		const { selection } = dataset;
		
		console.log('[onDragEnd]');
		
		$('.selectable.isDragging').removeClass('isDragging');
		
		this.refLayer.hide();
		this.unbind();
		
		if (selection) {
			selection.setBlocked(false);
		};
	};
	
	onDrop (e: any, type: string, targetId: string, position: I.BlockPosition) {
		const { rootId } = this.props;
		
		console.log('[onDrop]', type, targetId, this.type, this.ids, position);
		
		let request = {
			contextId: rootId,
			blockIds: this.ids || [],
			dropTargetId: targetId,
			position: position,
		};
		dispatcher.call('blockListMove', request, (errorCode: any, message: any) => {});
	};
	
	unbind () {
		$(window).unbind('dragend.drag drag.drag');	
	};
	
	set (type: string, ids: string[]) {
		this.type = type;
		this.ids = ids.map((id: any) => { return id.toString(); });
		
		$('.selectable.isDragging').removeClass('isDragging');
		for (let id of this.ids) {
			$($.escapeSelector('.selectable.c' + id)).addClass('isDragging');
		};
	};
	
	setDragImage (e: any) {
		let el = $('#emptyDragImage');
		
		if (!el.length) {
			el = $('<div id="emptyDragImage">');
			$('body').append(el);
		};
		
		el.css({ width: 1, height: 1, opacity: 0 });
		e.dataTransfer.setDragImage(el.get(0), 0, 0);
	};
	
	injectProps (children: any) {
		return React.Children.map(children, (child: any) => {
			let children = child.props.children;
			let dataset = child.props.dataset || {};
			
			if (children) {
				child = React.cloneElement(child, { children: this.injectProps(children) });
			};
			
			dataset.dragProvider = this;
			dataset.onDragStart = this.onDragStart;
			dataset.onDrop = this.onDrop;
			
			return React.cloneElement(child, { dataset: dataset });
		});
	};
	
};

export default DragProvider;