const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const { token } = require('./config.json');

const fs = require('node:fs');

let localWordIndex = [];
try {
    const data = fs.readFileSync('./words.txt', 'utf8');
    localWordIndex = data.split(/\r?\n/).map(word => word.trim()).filter(word => word.length > 0);
    console.log(`Loaded ${localWordIndex.length} words from local index`);
} catch (err) {
    console.error('Error loading words from local index:', err);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if(interaction.isAutocomplete()) {
        const focusedOption = interaction.options.getFocused(true);
        if(focusedOption.name === 'slowo') {
            const query = focusedOption.value.toLowerCase();
            const filteredWords = localWordIndex.filter(word => word.toLowerCase().startsWith(query));

            const choices = filteredWords.slice(0, 25).map(word => ({
                name: word,
                value: word
            }));

            await interaction.respond(choices);
        }
    }

    if(!interaction.isCommand()) return;

    const { commandName } = interaction;
    if(commandName === 'slowo') {
        await interaction.deferReply();
        const wordToSearch = interaction.options.getString('slowo').replace(/ /g, '+');
        const sjpUrl = `https://sjp.pl/${encodeURIComponent(wordToSearch)}`;

        let sjpData = null;

        try {

            const { data } = await axios.get(sjpUrl);
            const $ = cheerio.load(data);

            if($('h1').text().includes('✕')) {
                result = {
                    error: '404: The word was not found in the dictionary'
                }
            };

            const results = [];
            $('h1').each((i, h1) => {
                const element = $(h1);
                const title = element.text().trim();

                if(!title) return;

                const pAcceptable = element.next('p');
                const pLink = pAcceptable.next('p');
                const definitionP = pLink.nextAll('p[style*="font: medium/1.4 sans-serif"]').first();

                const acceptable = !pAcceptable.text().includes('niedopuszczalne');

                let declinable = null;
                let sourceDictionary = null;

                const detailsLink = pLink.find('a.lc').first();
                if(detailsLink.lenth) {
                    const onclickAttr = detailsLink.attr('onclick');
                    if(onclickAttr) {
                        const match = onclickAttr.match(/dopen\((\d+)/);
                        if(match && match[1]) {
                            const divId = `#d${match[1]}`;
                            $(divId).find('table.wtab tr').each((i, row) => {
                                const th = $(row).find('th[scope="row"]');
                                const thText = th.text().trim();
                                if(thText === 'odmienność') {
                                    declinable = th.next('td').text().trim() === 'tak';
                                } else if(thText === 'występowanie') {
                                    sourceDictionary = th.next('td').text().trim();
                                }
                            });
                        }
                    }
                }

                let meanings = [];
                const definitionHtml = definitionP.html();

                if(definitionHtml) {
                    let potentialMeanings = definitionHtml.split('<br>').map(s => s.trim()).filter(Boolean);
                    let prefix = '';

                    if(potentialMeanings.length > 1 && potentialMeanings[0].endsWith(':')) {
                        prefix = potentialMeanings.shift() + ' ';
                    }

                    meanings = potentialMeanings.map(meaning => {
                        return (prefix + meaning.replace(/^[0-9]+\.\s*/, '')).trim();
                    })
                }

                if(meanings.length > 0) {
                    results.push({
                        word: title,
                        acceptable_in_games: acceptable,
                        declinable: declinable,
                        sourceDictionary: sourceDictionary,
                        meanings: meanings
                    })
                }

            });


            if(results.length > 0) {
                sjpData = results;
            } else {
                sjpData = {
                    error: '404: The word was not found in the dictionary'
                };
            }

        } catch (e) {
            console.error('Error fetching word definition:', e);

            // await interaction.editReply('Wystąpił błąd podczas pobierania definicji słowa.');
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Błąd')
                .setDescription('Wystąpił błąd podczas pobierania definicji słowa.')
                .setTimestamp();
                
            await interaction.editReply({ embeds: [embed], ephemeral: true });

            return;
        }

        let ephemeral = interaction.options.getBoolean('shhh') || false;

        if(sjpData.error) {
            // await interaction.editReply(sjpData.error);

            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('Błąd')
                .setDescription(sjpData.error)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], ephemeral: true });

            return;
        } else {
            const embed = new EmbedBuilder()
                .setColor('#0099FF')
                .setTitle(`Definicja słowa: ${sjpData[0].word}`)
                .setDescription(sjpData[0].meanings.join('\n'))
                .addFields(
                    { name: 'Dopuszczalne w grach', value: sjpData[0].acceptable_in_games ? 'Tak' : 'Nie', inline: true },
                    { name: 'Odmienne', value: sjpData[0].declinable ? 'Tak' : 'Nie', inline: true },
                    { name: 'Źródło', value: sjpData[0].sourceDictionary || 'Brak', inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed], ephemeral: ephemeral });
        }

    }

});

client.login(token);