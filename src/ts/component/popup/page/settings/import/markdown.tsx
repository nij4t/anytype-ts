import * as React from 'react';
import { RouteComponentProps } from 'react-router';
import { IconObject, Title, Label, Button, Icon } from 'Component';
import { I, Util, translate } from 'Lib';
import Head from '../head';

interface Props extends I.Popup, RouteComponentProps<any> {
	prevPage: string;
	onPage: (id: string) => void;
	onImport: (type: I.ImportType, param: any, callBack?: (message: any) => void) => void;
};

class PopupSettingsPageImportMarkdown extends React.Component<Props> {

	constructor (props: Props) {
		super(props);

		this.onImport = this.onImport.bind(this);
	};

	render () {
		return (
			<div>
				<Head {...this.props} returnTo="importIndex" name={translate('popupSettingsImportTitle')} />

				<Icon className="logo" />
				<Title text={translate('popupSettingsImportMarkdownTitle')} />

				<div className="path">
					<b>{translate('popupSettingsImportNotionExample')}</b>

					<ul>
						<li>{translate('popupSettingsImportNotionExampleStep1')}</li>
						<li>{translate('popupSettingsImportNotionExampleStep2')}</li>
						<li>{translate('popupSettingsImportNotionExampleStep3')}</li>
					</ul>
				</div>

				<Label text={translate('popupSettingsImportNotionExampleComplete')} />
				
				<div className="buttons">
					<Button className="c36" text={translate('popupSettingsImportOk')} onClick={this.onImport} />
				</div>
			</div>
		);
	};

	onImport () {
		const { close, onImport } = this.props;
		const platform = Util.getPlatform();
		const options: any = { 
			properties: [ 'openFile' ],
			filters: [
				{ name: '', extensions: [ 'zip', 'md' ] }
			]
		};

		if (platform == I.Platform.Mac) {
			options.properties.push('openDirectory');
		};

		window.Electron.showOpenDialog(options).then((result: any) => {
			const files = result.filePaths;
			if ((files == undefined) || !files.length) {
				return;
			};

			close();
			onImport(I.ImportType.Markdown, { path: files[0] });
		});
	};

};

export default PopupSettingsPageImportMarkdown;