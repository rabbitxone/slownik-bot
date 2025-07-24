const { App, ExpressReceiver } = require('@slack/bolt');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
require('dotenv').config();

const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    stateSecret: process.env.SLACK_STATE_SECRET,
    scopes: ['commands', 'chat:write'],
    installerOptions: {
        redirectUriPath: '/slack/oauth/callback',
        redirectUri: process.env.FQDN ? `https://${process.env.FQDN}/slack/oauth/callback` : undefined,
        callbackOptions: {
            success: (installation, installOptions, req, res) => {
                console.log('OAuth success:', installation);
                res.send('Success! The dictionary bot is now installed.');
            },
            failure: (error, installOptions, req, res) => {
                console.error('OAuth failure:', error);
                res.send(`Installation failed: ${error.message}`);
            }
        }
    }
});

const app = new App({
    receiver,
    // token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});

app.command('/slowo', async ({ command, ack, respond }) => {
    try {
        await ack();

        const ephemeral = command.text.toLowerCase().endsWith(' shhh') ? true : false;
        const wordToSearch = command.text.replace(/ shhh$/, '').trim().replace(/ /g, '+');
        const sjpUrl = `https://sjp.pl/${encodeURIComponent(wordToSearch)}`;

        let sjpData = null;

        try {
            const { data } = await axios.get(sjpUrl);
            const $ = cheerio.load(data);

            if ($('h1').text().includes('✕')) {
                sjpData = {
                    error: '404: The word was not found in the dictionary'
                }
                return;
            };

            const results = [];
            $('h1').each((i, h1) => {
                const element = $(h1);
                const title = element.text().trim();

                if (!title) return;

                const pAcceptable = element.next('p');
                const pLink = pAcceptable.next('p');
                const definitionP = pLink.nextAll('p[style*="font: medium/1.4 sans-serif"]').first();

                const acceptable = !pAcceptable.text().includes('niedopuszczalne');

                let declinable = null;
                let sourceDictionary = null;

                const detailsLink = pLink.find('a.lc').first();
                if (detailsLink.length) {
                    const onclickAttr = detailsLink.attr('onclick');
                    if (onclickAttr) {
                        const match = onclickAttr.match(/dopen\((\d+)/);
                        if (match && match[1]) {
                            const divId = `#d${match[1]}`;
                            $(divId).find('table.wtab tr').each((i, row) => {
                                const th = $(row).find('th[scope="row"]');
                                const thText = th.text().trim();
                                if (thText === 'odmienność') {
                                    declinable = $(row).find('td').text().trim() === 'tak';
                                } else if (thText === 'występowanie') {
                                    sourceDictionary = $(row).find('td').text().trim();
                                }
                            });
                        }
                    }
                }

                let meanings = [];
                const definitionHtml = definitionP.html();

                if (definitionHtml) {
                    let potentialMeanings = definitionHtml
                        .split('<br>')
                        .map(s => s.replace(/&nbsp;/g, ' ').trim())
                        .filter(Boolean);
                    let prefix = '';

                    if (potentialMeanings.length > 1 && potentialMeanings[0].endsWith(':')) {
                        prefix = potentialMeanings.shift() + ' ';
                    }

                    meanings = potentialMeanings.map(meaning => {
                        return (prefix + meaning.replace(/^[0-9]+\.\s*/, '')).trim();
                    });
                }

                if (meanings.length > 0) {
                    results.push({
                        word: title,
                        acceptable_in_games: acceptable,
                        declinable: declinable,
                        sourceDictionary: sourceDictionary,
                        meanings: meanings
                    });
                }
            });


            if (results.length > 0) {
                sjpData = results;
            } else {
                sjpData = {
                    error: '404: The word was not found in the dictionary'
                };
            }

        } catch (e) {
            console.error('Error fetching word definition:', e);

            await respond({
                text: 'Nie znaleziono słowa `' + wordToSearch + '` w słowniku sjp.pl :(',
                response_type: 'ephemeral'
            });

            return;
        }

        if (sjpData.error) {
            await respond({
                text: 'Nie znaleziono słowa `' + wordToSearch + '` w słowniku sjp.pl :(',
                response_type: 'ephemeral'
            });
            return;
        } else {
            let blocks = [];
            sjpData.forEach((entry, index) => {
                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Definicja słowa:* \`${entry.word}\`\n`
                    }
                });

                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `Dopuszczalne w grach słownych: ${entry.acceptable_in_games ? '✅ TAK' : '❌ NIE'}\n` +
                            `Odmienne przez przypadki: ${entry.declinable ? '✅ TAK' : '❌ NIE'}\n` +
                            `Słownik źródłowy: ${entry.sourceDictionary || '*Brak informacji*'}\n`
                    }
                });

                if (entry.meanings.length > 0) {
                    entry.meanings.forEach(meaning => {
                        blocks[blocks.length - 1].text.text += `\n• ${meaning}`;
                    });
                } else {
                    blocks.push({
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '*Brak definicji*'
                        }
                    });
                }

                if (index < sjpData.length - 1) {
                    blocks.push({
                        type: 'divider'
                    });
                }
            });

            await respond({
                blocks: blocks,
                response_type: ephemeral ? 'ephemeral' : 'in_channel'
            });

        }

    } catch (e) {
        console.error('Error handling /slowo command:', e);
    }
});

app.command('/synonim', async ({ command, ack, respond }) => {
    try {
        await ack();

        const ephemeral = command.text.toLowerCase().endsWith(' shhh') ? true : false;
        const wordToSearch = command.text.replace(/ shhh$/, '').trim().replace(/ /g, '+');

        let thesaurusGroups = [];

        try {
            const thesaurusContent = fs.readFileSync('../../thesaurus.txt', 'utf8');
            const thesaurusLines = thesaurusContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
            thesaurusLines.forEach(line => {
                const [word, ...synonyms] = line.split(';').map(part => part.trim());
                if (word.toLowerCase() === wordToSearch.toLowerCase()) {
                    thesaurusGroups.push(synonyms.map(syn => syn.trim()).filter(Boolean));
                }
            });

        } catch (e) {
            console.error('Error loading thesaurus data:', e);
            await respond({
                text: 'Nie znaleziono synonimów słowa `' + wordToSearch + '` w słowniku synonimów :(',
                response_type: 'ephemeral'
            });
            return;
        }

        if (thesaurusGroups.length === 0) {
            await respond({
                text: 'Nie znaleziono synonimów słowa `' + wordToSearch + '` w słowniku synonimów :(',
                response_type: 'ephemeral'
            });
            return;
        } else {

            let blocks = [];
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Synonimy słowa:* \`${wordToSearch}\`\n`
                }
            });

            let synonymsText = '';
            thesaurusGroups.forEach((group, idx) => {
                if (group.length === 0) return;
                if (idx > 0) synonymsText += '\n';
                synonymsText += '• ' + group.join(', ');
            });

            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: synonymsText
                }
            });

            await respond({
                blocks: blocks,
                response_type: ephemeral ? 'ephemeral' : 'in_channel'
            });
        }

    } catch (e) {
        console.error('Error handling /synonim command:', e);
    }
});

(async () => {
    await app.start(process.env.PORT || 3000);
    console.log('Slack bot is running on port', process.env.PORT || 3000);
})();