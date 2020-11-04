import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Tag } from 'ts/component';
import { I, keyboard, DataUtil, Util } from 'ts/lib';
import { commonStore, dbStore } from 'ts/store';
import { observer } from 'mobx-react';
import { set, observable } from 'mobx';
import { setRange } from 'selection-ranges';

interface Props extends I.Cell {};
interface State { 
	editing: boolean; 
};

const $ = require('jquery');

@observer
class CellSelect extends React.Component<Props, State> {

	state = {
		editing: false,
	};

	constructor (props: any) {
		super(props);
	
		this.onFocus = this.onFocus.bind(this);
		this.onBlur = this.onBlur.bind(this);
		this.onKeyDown = this.onKeyDown.bind(this);
		this.onKeyUp = this.onKeyUp.bind(this);
	};

	render () {
		const { index, block, relation, readOnly } = this.props;
		const data = dbStore.getData(block.id);
		const rel = dbStore.getRelation(block.id, relation.key);
		const value = data[index][relation.key] || [];

		return (
			<div>
				{value.map((item: string, i: any) => {
					const option = (rel.selectDict || []).find((it: any) => { return it.text == item; });
					if (!option) {
						return null;
					};
					return (
						<React.Fragment key={i}>
							<Tag text={option.text} color={option.color} canEdit={true} onRemove={(e: any) => { this.onRemove(e, option.text); }} />
							{" "}
						</React.Fragment>
					);
				})}
				<div 
					id="edit" 
					className="tagItem" 
					contentEditable={!readOnly} 
					suppressContentEditableWarning={true} 
					onKeyDown={this.onKeyDown} 
					onKeyUp={this.onKeyUp}
					onFocus={this.onFocus} 
					onBlur={this.onBlur}
				/>
			</div>
		);
	};

	componentDidUpdate () {
		const { editing } = this.state;
		const { id, relation } = this.props;
		const cellId = DataUtil.cellId('cell', relation.key, id);
		const cell = $('#' + cellId);

		if (editing) {
			cell.addClass('isEditing');
		} else {
			cell.removeClass('isEditing');
		};
	};

	setEditing (v: boolean) {
		const { viewType, readOnly } = this.props;
		const { editing } = this.state;
		const canEdit = !readOnly && (viewType == I.ViewType.Grid);

		if (canEdit && (v != editing)) {
			this.setState({ editing: v });
		};
	};

	onClick () {
		this.focus();
	};

	onChange (value: string[]) {
		this.focus();
	};

	focus () {
		const node = $(ReactDOM.findDOMNode(this));
		const edit = node.find('#edit');

		edit.focus();
		setRange(edit.get(0), { start: 0, end: 0 });
	};

	onFocus () {
		keyboard.setFocus(true);
	};

	onBlur () {
		keyboard.setFocus(false);
	};

	onKeyDown (e: any) {
		const { relation, block, index } = this.props;
		const node = $(ReactDOM.findDOMNode(this));
		const edit = node.find('#edit');
		const data = dbStore.getData(block.id);
		const value = data[index][relation.key] || [];

		keyboard.shortcut('enter', e, (pressed: string) => {
			e.preventDefault();

			this.getValue(value, edit.text().split(/\s/));
			edit.html('');
		});
	};

	onKeyUp (e: any) {
		const { relation, block, index } = this.props;
		const node = $(ReactDOM.findDOMNode(this));
		const edit = node.find('#edit');
		const length = edit.text().length;
		const data = dbStore.getData(block.id);
		const value = data[index][relation.key] || [];

		keyboard.shortcut('enter', e, (pressed: string) => {
			e.preventDefault();

			this.getValue(value, edit.text().split(/\s/));
			edit.html('');
		});

		keyboard.shortcut('backspace', e, (pressed: string) => {
			if (length || !value.length) {
				return;
			};

			this.remove(value[value.length - 1]);
		});
	};

	onRemove (e: any, text: string) {
		e.stopPropagation();

		this.remove(text);
	};

	remove (text: string) {
		const { relation, block, index } = this.props;
		const data = dbStore.getData(block.id);
		
		let value = data[index][relation.key] || [];
		value = value.filter((it: string) => { return it != text });
		this.getValue(value, []);
	};

	getValue (value: string[], text: string[]) {
		const { block, relation, onChange } = this.props;
		const { menus } = commonStore;
		const menu = menus.find((item: I.Menu) => { return item.id == 'dataviewOptionList'; });
		const colors = DataUtil.menuGetBgColors();

		text = text.map((it: string) => {
			return String(it || '').trim();
		});
		text = text.filter((it: string) => { return it; });
		text = value.concat(text);
		text = Util.arrayUnique(text);

		let options = text.map((it: string) => {
			const color = colors[Util.rand(0, colors.length - 1)];
			return { text: it, color: color.value };
		});

		options = relation.selectDict.concat(options);
		options = Util.arrayUniqueObjects(options, 'text');

		relation.selectDict = options;
		dbStore.relationUpdate(block.id, relation);

		if (menu) {
			menu.param.data.value = text;
			menu.param.data.relation = observable.box(relation);
			commonStore.menuUpdate('dataviewOptionList', menu.param);
		};

		onChange(text);
	};

};

export default CellSelect;