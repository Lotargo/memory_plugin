// UI messages. Numbered placeholders preserve user text and identifiers verbatim.
export const messages = {
  "m1": {
    "ru": "Все записи",
    "en": "All records",
    "zh-CN": "全部记录"
  },
  "m2": {
    "ru": "Инструкции",
    "en": "Instructions",
    "zh-CN": "指令"
  },
  "m3": {
    "ru": "История",
    "en": "History",
    "zh-CN": "历史"
  },
  "m4": {
    "ru": "Знания",
    "en": "Knowledge",
    "zh-CN": "知识"
  },
  "m5": {
    "ru": "Срок истёк",
    "en": "Expired",
    "zh-CN": "已过期"
  },
  "m6": {
    "ru": "Заменена",
    "en": "Superseded",
    "zh-CN": "已替代"
  },
  "m7": {
    "ru": "Выключена",
    "en": "Disabled",
    "zh-CN": "已停用"
  },
  "m8": {
    "ru": "Повреждённый формат",
    "en": "Invalid format",
    "zh-CN": "格式无效"
  },
  "m9": {
    "ru": "Заголовок",
    "en": "Title",
    "zh-CN": "标题"
  },
  "m10": {
    "ru": "Текст записи",
    "en": "Record text",
    "zh-CN": "记录正文"
  },
  "m11": {
    "ru": "Тип",
    "en": "Type",
    "zh-CN": "类型"
  },
  "m12": {
    "ru": "Срок действия",
    "en": "Lifetime",
    "zh-CN": "有效期"
  },
  "m13": {
    "ru": "Теги",
    "en": "Tags",
    "zh-CN": "标签"
  },
  "m14": {
    "ru": "Защита от удаления",
    "en": "Deletion protection",
    "zh-CN": "删除保护"
  },
  "m15": {
    "ru": "Инструкция выключена",
    "en": "Instruction disabled",
    "zh-CN": "指令已停用"
  },
  "m16": {
    "ru": "Подключение истекло или адрес неполный. Откройте полный адрес, выведенный командой memory-plugin web.",
    "en": "Connection expired or URL incomplete. Open the full URL printed by memory-plugin web.",
    "zh-CN": "连接已过期或地址不完整。请打开 memory-plugin web 输出的完整地址。"
  },
  "m17": {
    "ru": "Память из прежнего облачного режима требует восстановления. Откройте «Настройки», примените режим «Локально + облачные снимки» для резервирования обеих копий, затем загрузите локальный список снимков и восстановите подготовленный облачный архив после проверки предпросмотра.",
    "en": "Legacy cloud memory needs recovery. Open Settings, apply Local + cloud snapshots to back up both copies, then load the local snapshot list and restore the prepared cloud archive after reviewing the preview.",
    "zh-CN": "旧云端模式的记忆需要恢复。打开“设置”，应用“本地 + 云端快照”以备份两个副本，然后加载本地快照列表，检查预览后恢复已准备的云端存档。"
  },
  "m18": {
    "ru": "Память изменилась в другом клиенте. Ваш текст остаётся в редакторе. Обновите данные и сравните правку с текущей записью перед повторным сохранением.",
    "en": "Memory changed in another client. Your draft remains in the editor. Refresh and compare it with the current record before saving again.",
    "zh-CN": "其他客户端已更改记忆。草稿仍保留在编辑器中。请刷新并与当前记录比较后再保存。"
  },
  "m19": {
    "ru": "Запись связана с источниками. Откройте «Добавить связь» и выполните «Подготовить связи», чтобы безопасно менять текст и удалять связанные записи. Метаданные доступны сейчас.",
    "en": "This record has source links. Open Add link and run Prepare links to safely edit or delete linked records. Metadata is editable now.",
    "zh-CN": "此记录有关联来源。打开“添加关联”并执行“准备关联”，即可安全编辑或删除关联记录。目前可编辑元数据。"
  },
  "m20": {
    "ru": "Эта операция пока недоступна для выбранного хранилища. Проверьте режим и идентичность проекта в CLI.",
    "en": "This operation is unavailable for this store. Check its mode and project identity in the CLI.",
    "zh-CN": "此存储暂不支持此操作。请在 CLI 中检查模式和项目标识。"
  },
  "m21": {
    "ru": "Хранилище больше не доступно. Обновите список областей.",
    "en": "Store no longer available. Refresh the scope list.",
    "zh-CN": "存储已不可用。请刷新范围列表。"
  },
  "m22": {
    "ru": "Запись с таким текстом уже есть в этой области.",
    "en": "A record with this text already exists in this scope.",
    "zh-CN": "此范围内已存在相同正文的记录。"
  },
  "m23": {
    "ru": "Не удалось сохранить поля записи. Проверьте текст, теги и срок действия.",
    "en": "Could not save record fields. Check the text, tags and lifetime.",
    "zh-CN": "无法保存记录字段。请检查正文、标签和有效期。"
  },
  "m24": {
    "ru": "Не удалось обратиться к хранилищу. Проверьте, что локальная панель запущена, и повторите действие.",
    "en": "Could not access storage. Check that the local dashboard is running and try again.",
    "zh-CN": "无法访问存储。请确认本地面板正在运行，然后重试。"
  },
  "m25": {
    "ru": "Операция с проектом завершена. Резервный снимок: {0}",
    "en": "Project operation completed. Backup: {0}",
    "zh-CN": "项目操作已完成。备份：{0}"
  },
  "m26": {
    "ru": "Регистрация проекта обновлена.",
    "en": "Project registration updated.",
    "zh-CN": "项目注册已更新。"
  },
  "m27": {
    "ru": "Инструкция перенесена. Резервный снимок: {0}.{1} Активные сессии могут хранить прежний контекст.",
    "en": "Instruction moved. Backup: {0}.{1} Active sessions may retain the previous context.",
    "zh-CN": "指令已移动。备份：{0}。{1} 活动会话可能仍保留旧上下文。"
  },
  "m28": {
    "ru": " Синхронизация клиентских файлов выполнена частично; проверьте её через sync-persona.",
    "en": " Client file sync was partial; check it with sync-persona.",
    "zh-CN": " 客户端文件仅部分同步；请通过 sync-persona 检查。"
  },
  "m29": {
    "ru": "Запись изменилась после предпросмотра. Обновите предпросмотр и откройте её снова.",
    "en": "Record changed since preview. Refresh the preview and open it again.",
    "zh-CN": "记录在预览后已更改。请刷新预览并重新打开。"
  },
  "m30": {
    "ru": "Выберите конкретный проект для предпросмотра.",
    "en": "Select a specific project to preview.",
    "zh-CN": "请选择具体项目进行预览。"
  },
  "m31": {
    "ru": "Глобальная память",
    "en": "Global memory",
    "zh-CN": "全局记忆"
  },
  "m32": {
    "ru": "Общий список; выберите проект для правки",
    "en": "Combined list; select a project to edit",
    "zh-CN": "汇总列表；选择项目以编辑"
  },
  "m33": {
    "ru": "Доступна во всех проектах",
    "en": "Available in all projects",
    "zh-CN": "适用于所有项目"
  },
  "m34": {
    "ru": "Только выбранный проект",
    "en": "Selected project only",
    "zh-CN": "仅所选项目"
  },
  "m35": {
    "ru": "+ Новая инструкция",
    "en": "+ New instruction",
    "zh-CN": "+ 新建指令"
  },
  "m36": {
    "ru": "+ Новая запись",
    "en": "+ New record",
    "zh-CN": "+ 新建记录"
  },
  "m37": {
    "ru": "Истёкшие и заменённые",
    "en": "Expired and superseded",
    "zh-CN": "已过期和已替代"
  },
  "m38": {
    "ru": "Текущие записи",
    "en": "Current records",
    "zh-CN": "当前记录"
  },
  "m39": {
    "ru": "Выберите хранилище для новой записи.",
    "en": "Select a store for the new record.",
    "zh-CN": "请选择新记录的存储。"
  },
  "m40": {
    "ru": "Редактирование в этом режиме недоступно.",
    "en": "Editing is unavailable in this mode.",
    "zh-CN": "此模式下无法编辑。"
  },
  "m41": {
    "ru": "Проекты",
    "en": "Projects",
    "zh-CN": "项目"
  },
  "m42": {
    "ru": "Другие хранилища",
    "en": "Other stores",
    "zh-CN": "其他存储"
  },
  "m43": {
    "ru": "Требуют проверки",
    "en": "Needs review",
    "zh-CN": "需要检查"
  },
  "m44": {
    "ru": "Неизвестное хранилище",
    "en": "Unknown store",
    "zh-CN": "未知存储"
  },
  "m45": {
    "ru": "запись",
    "en": "record",
    "zh-CN": "条记录"
  },
  "m46": {
    "ru": "записи",
    "en": "records",
    "zh-CN": "条记录"
  },
  "m47": {
    "ru": "записей",
    "en": "records",
    "zh-CN": "条记录"
  },
  "m48": {
    "ru": "Загружаем память…",
    "en": "Loading memory…",
    "zh-CN": "正在加载记忆…"
  },
  "m49": {
    "ru": "Данные недоступны",
    "en": "Data unavailable",
    "zh-CN": "数据不可用"
  },
  "m50": {
    "ru": "Ничего не найдено. Попробуйте другой запрос.",
    "en": "Nothing found. Try another query.",
    "zh-CN": "未找到结果。请尝试其他查询。"
  },
  "m51": {
    "ru": "Истёкших и заменённых записей нет.",
    "en": "No expired or superseded records.",
    "zh-CN": "没有已过期或已替代的记录。"
  },
  "m52": {
    "ru": "В этой области пока нет записей с выбранным состоянием.",
    "en": "No records with this status in this scope yet.",
    "zh-CN": "此范围内暂无该状态的记录。"
  },
  "m53": {
    "ru": "Начальная дата должна быть не позже конечной.",
    "en": "Start date must not be later than end date.",
    "zh-CN": "开始日期不能晚于结束日期。"
  },
  "m54": {
    "ru": "Неполный список. Недоступные хранилища: {0}.",
    "en": "Incomplete list. Unavailable stores: {0}.",
    "zh-CN": "列表不完整。不可用的存储：{0}。"
  },
  "m55": {
    "ru": "Требует исправления",
    "en": "Needs correction",
    "zh-CN": "需要修正"
  },
  "m56": {
    "ru": "Инструкция",
    "en": "Instruction",
    "zh-CN": "指令"
  },
  "m57": {
    "ru": "Факт",
    "en": "Fact",
    "zh-CN": "事实"
  },
  "m58": {
    "ru": "Без даты",
    "en": "No date",
    "zh-CN": "无日期"
  },
  "m59": {
    "ru": "Запись без заголовка",
    "en": "Untitled record",
    "zh-CN": "无标题记录"
  },
  "m60": {
    "ru": "Защищена",
    "en": "Protected",
    "zh-CN": "已保护"
  },
  "m61": {
    "ru": "Обновлено {0}",
    "en": "Updated {0}",
    "zh-CN": "更新于 {0}"
  },
  "m62": {
    "ru": "Нет актуальных данных",
    "en": "No current data",
    "zh-CN": "暂无最新数据"
  },
  "m63": {
    "ru": "Защищена от удаления",
    "en": "Protected from deletion",
    "zh-CN": "已启用删除保护"
  },
  "m64": {
    "ru": "Область",
    "en": "Scope",
    "zh-CN": "范围"
  },
  "m65": {
    "ru": "Ключ хранилища",
    "en": "Store key",
    "zh-CN": "存储键"
  },
  "m66": {
    "ru": "ID записи",
    "en": "Record ID",
    "zh-CN": "记录 ID"
  },
  "m67": {
    "ru": "Legacy — присвоится при сохранении",
    "en": "Legacy — assigned on save",
    "zh-CN": "旧记录 — 保存时分配"
  },
  "m68": {
    "ru": "Создана",
    "en": "Created",
    "zh-CN": "创建时间"
  },
  "m69": {
    "ru": "Без ограничения",
    "en": "Unlimited",
    "zh-CN": "无限制"
  },
  "m70": {
    "ru": "Заменена записью",
    "en": "Superseded by",
    "zh-CN": "替代记录"
  },
  "m71": {
    "ru": "Заменяет запись",
    "en": "Supersedes",
    "zh-CN": "所替代的记录"
  },
  "m72": {
    "ru": "строки",
    "en": "lines",
    "zh-CN": "行"
  },
  "m73": {
    "ru": "запрошены строки",
    "en": "requested lines",
    "zh-CN": "请求的行"
  },
  "m74": {
    "ru": "Источник недоступен в этой области",
    "en": "Source unavailable in this scope",
    "zh-CN": "来源在此范围内不可用"
  },
  "m75": {
    "ru": "Изменить связь",
    "en": "Edit link",
    "zh-CN": "编辑关联"
  },
  "m76": {
    "ru": "Удалить связь",
    "en": "Delete link",
    "zh-CN": "删除关联"
  },
  "m77": {
    "ru": "Общий список доступен для просмотра. Для правки откройте хранилище выбранной записи.",
    "en": "The combined list is read-only. Open the selected record's store to edit.",
    "zh-CN": "汇总列表仅供查看。请打开所选记录的存储以编辑。"
  },
  "m78": {
    "ru": "В этом режиме доступен только просмотр.",
    "en": "Read-only in this mode.",
    "zh-CN": "此模式下仅可查看。"
  },
  "m79": {
    "ru": "Не сохранено",
    "en": "Unsaved",
    "zh-CN": "未保存"
  },
  "m80": {
    "ru": "Без изменений",
    "en": "Unchanged",
    "zh-CN": "无更改"
  },
  "m81": {
    "ru": "Замещение новой записью",
    "en": "Supersede with a new record",
    "zh-CN": "用新记录替代"
  },
  "m82": {
    "ru": "Редактирование записи",
    "en": "Edit record",
    "zh-CN": "编辑记录"
  },
  "m83": {
    "ru": "Новая запись",
    "en": "New record",
    "zh-CN": "新建记录"
  },
  "m84": {
    "ru": "Укажите заголовок.",
    "en": "Enter a title.",
    "zh-CN": "请输入标题。"
  },
  "m85": {
    "ru": "Введите текст записи.",
    "en": "Enter record text.",
    "zh-CN": "请输入记录正文。"
  },
  "m86": {
    "ru": "Используйте одну строку без комментариев метаданных.",
    "en": "Use a single line without metadata comments.",
    "zh-CN": "请使用单行文本，不含元数据注释。"
  },
  "m87": {
    "ru": "Заголовок не должен содержать звёздочки.",
    "en": "Title must not contain asterisks.",
    "zh-CN": "标题不能包含星号。"
  },
  "m88": {
    "ru": "Укажите положительный срок, например 90d, 2w или 24h.",
    "en": "Enter a positive lifetime, such as 90d, 2w or 24h.",
    "zh-CN": "请输入正数有效期，例如 90d、2w 或 24h。"
  },
  "m89": {
    "ru": "Срок должен быть короче 21 символа.",
    "en": "Lifetime must be shorter than 21 characters.",
    "zh-CN": "有效期必须少于 21 个字符。"
  },
  "m90": {
    "ru": "Теги разделяются запятыми; двоеточия и комментарии не поддерживаются.",
    "en": "Separate tags with commas; colons and comments are unsupported.",
    "zh-CN": "请用逗号分隔标签；不支持冒号和注释。"
  },
  "m91": {
    "ru": "Да",
    "en": "Yes",
    "zh-CN": "是"
  },
  "m92": {
    "ru": "Нет",
    "en": "No",
    "zh-CN": "否"
  },
  "m93": {
    "ru": "Не указано",
    "en": "Not specified",
    "zh-CN": "未指定"
  },
  "m94": {
    "ru": "Изменений нет. Измените поле или отмените редактирование.",
    "en": "No changes. Edit a field or cancel editing.",
    "zh-CN": "没有更改。请编辑字段或取消编辑。"
  },
  "m95": {
    "ru": "Прежняя запись останется в истории вместе со своими источниками. Новая получит отдельный ID и новую дату; срок действия начнётся заново. Связи с источниками не копируются.",
    "en": "The old record and its sources stay in history. The new record gets a separate ID and date; its lifetime restarts. Source links are not copied.",
    "zh-CN": "旧记录及其来源将保留在历史中。新记录将获得独立 ID 和新日期，有效期重新计算。不会复制来源关联。"
  },
  "m96": {
    "ru": "Было",
    "en": "Before",
    "zh-CN": "更改前"
  },
  "m97": {
    "ru": "Станет",
    "en": "After",
    "zh-CN": "更改后"
  },
  "m98": {
    "ru": "Замещение записи",
    "en": "Supersede record",
    "zh-CN": "替代记录"
  },
  "m99": {
    "ru": "Проверка изменений",
    "en": "Review changes",
    "zh-CN": "检查更改"
  },
  "m100": {
    "ru": "Создание записи",
    "en": "Create record",
    "zh-CN": "创建记录"
  },
  "m101": {
    "ru": "Сохраняем…",
    "en": "Saving…",
    "zh-CN": "正在保存…"
  },
  "m102": {
    "ru": "Сохранить запись",
    "en": "Save record",
    "zh-CN": "保存记录"
  },
  "m103": {
    "ru": "Удаляем…",
    "en": "Deleting…",
    "zh-CN": "正在删除…"
  },
  "m104": {
    "ru": "Удалить запись",
    "en": "Delete record",
    "zh-CN": "删除记录"
  },
  "m105": {
    "ru": " Для активных сессий обновите контекст клиента.",
    "en": " Refresh the client context for active sessions.",
    "zh-CN": " 请为活动会话刷新客户端上下文。"
  },
  "m106": {
    "ru": "Запись сохранена, но синхронизация инструкций клиента завершилась с ошибкой. Повторите синхронизацию в CLI.",
    "en": "Record saved, but client instruction sync failed. Retry sync in the CLI.",
    "zh-CN": "记录已保存，但客户端指令同步失败。请在 CLI 中重试同步。"
  },
  "m107": {
    "ru": "Запись сохранена.",
    "en": "Record saved.",
    "zh-CN": "记录已保存。"
  },
  "m108": {
    "ru": "Запись удалена, её ID неоднозначен или это legacy-запись. Черновик оставлен в редакторе. Обновите список и выберите запись заново; автоматическое сопоставление недоступно.",
    "en": "Record deleted, ID ambiguous, or legacy record. Draft retained. Refresh the list and select the record again; automatic matching is unavailable.",
    "zh-CN": "记录已删除、ID 不明确，或属于旧记录。草稿已保留。请刷新列表并重新选择记录；无法自动匹配。"
  },
  "m109": {
    "ru": "Запись уже заменена другим клиентом. Черновик сохранён; отмените замещение и откройте актуальную запись.",
    "en": "Another client already superseded this record. Draft retained; cancel replacement and open the current record.",
    "zh-CN": "其他客户端已替代此记录。草稿已保留；请取消替代并打开当前记录。"
  },
  "m110": {
    "ru": "Данные обновлены. Проверьте правку относительно текущей записи; сохранение ещё не выполнено.",
    "en": "Data refreshed. Review the draft against the current record; nothing has been saved yet.",
    "zh-CN": "数据已刷新。请对照当前记录检查草稿；尚未保存任何更改。"
  },
  "m111": {
    "ru": "Без заголовка",
    "en": "Untitled",
    "zh-CN": "无标题"
  },
  "m112": {
    "ru": "\nБудут удалены связи ({0}): {1}. Источники сохранятся.",
    "en": "\nLinks to delete ({0}): {1}. Sources will remain.",
    "zh-CN": "\n将删除关联（{0}）：{1}。来源将保留。"
  },
  "m113": {
    "ru": "Запись удалена из выбранной области.",
    "en": "Record deleted from the selected scope.",
    "zh-CN": "已从所选范围删除记录。"
  },
  "m114": {
    "ru": "Версия",
    "en": "Version",
    "zh-CN": "版本"
  },
  "m115": {
    "ru": "Режим",
    "en": "Mode",
    "zh-CN": "模式"
  },
  "m116": {
    "ru": "Хранилище",
    "en": "Storage",
    "zh-CN": "存储"
  },
  "m117": {
    "ru": "Известных проектов",
    "en": "Known projects",
    "zh-CN": "已知项目"
  },
  "m118": {
    "ru": "Не проверено",
    "en": "Not checked",
    "zh-CN": "未检查"
  },
  "m119": {
    "ru": "Проверено",
    "en": "Checked",
    "zh-CN": "检查时间"
  },
  "m120": {
    "ru": "Модели",
    "en": "Models",
    "zh-CN": "模型"
  },
  "m121": {
    "ru": "Состояние не проверялось",
    "en": "Status not checked",
    "zh-CN": "尚未检查状态"
  },
  "m122": {
    "ru": "Облако",
    "en": "Cloud",
    "zh-CN": "云端"
  },
  "m123": {
    "ru": "Запросы не выполнялись",
    "en": "No requests made",
    "zh-CN": "尚未发送请求"
  },
  "m124": {
    "ru": "Клиенты",
    "en": "Clients",
    "zh-CN": "客户端"
  },
  "m125": {
    "ru": "Подключение не найдено",
    "en": "Connection not found",
    "zh-CN": "未找到连接"
  },
  "m126": {
    "ru": "Чужая регистрация memory-agent",
    "en": "Foreign memory-agent registration",
    "zh-CN": "其他应用的 memory-agent 注册"
  },
  "m127": {
    "ru": "Прямой MCP",
    "en": "Direct MCP",
    "zh-CN": "直接 MCP"
  },
  "m128": {
    "ru": "Конфликт каналов",
    "en": "Channel conflict",
    "zh-CN": "渠道冲突"
  },
  "m129": {
    "ru": "Прямой MCP выключен",
    "en": "Direct MCP disabled",
    "zh-CN": "直接 MCP 已停用"
  },
  "m130": {
    "ru": "Только проектная регистрация",
    "en": "Project registration only",
    "zh-CN": "仅项目注册"
  },
  "m131": {
    "ru": "Проверка прошла",
    "en": "Check passed",
    "zh-CN": "检查通过"
  },
  "m132": {
    "ru": "Проверка завершена частично",
    "en": "Check partially completed",
    "zh-CN": "检查部分完成"
  },
  "m133": {
    "ru": "Ошибка проверки",
    "en": "Check failed",
    "zh-CN": "检查失败"
  },
  "m134": {
    "ru": "Проверка недоступна",
    "en": "Check unavailable",
    "zh-CN": "无法检查"
  },
  "m135": {
    "ru": "Время проверки истекло",
    "en": "Check timed out",
    "zh-CN": "检查超时"
  },
  "m136": {
    "ru": "Конфигурация изменилась во время проверки",
    "en": "Configuration changed during check",
    "zh-CN": "检查期间配置已更改"
  },
  "m137": {
    "ru": "Проверка адаптера поддерживает один прямой Node/boot.js или Codex/Claude marketplace без проектных переопределений. Npx и произвольные команды не запускаются.",
    "en": "Adapter check supports one direct Node/boot.js or Codex/Claude marketplace without project overrides. Npx and arbitrary commands are not run.",
    "zh-CN": "适配器检查支持单个直接 Node/boot.js 或 Codex/Claude marketplace，且不能有项目覆盖配置。不会运行 npx 或任意命令。"
  },
  "m138": {
    "ru": "Executable клиента не найден в PATH.",
    "en": "Client executable not found in PATH.",
    "zh-CN": "在 PATH 中未找到客户端可执行文件。"
  },
  "m139": {
    "ru": "Процесс не завершил проверку за 20 секунд; отправлено завершение дерева процессов.",
    "en": "Process did not finish within 20 seconds; process tree termination requested.",
    "zh-CN": "进程未在 20 秒内完成；已请求终止进程树。"
  },
  "m140": {
    "ru": "Вывод процесса превысил лимит 256 KiB.",
    "en": "Process output exceeded the 256 KiB limit.",
    "zh-CN": "进程输出超过 256 KiB 限制。"
  },
  "m141": {
    "ru": "Ответ процесса не соответствует ожидаемому протоколу.",
    "en": "Process response does not match the expected protocol.",
    "zh-CN": "进程响应不符合预期协议。"
  },
  "m142": {
    "ru": "Данные адаптера и runtime расходятся.",
    "en": "Adapter and runtime data disagree.",
    "zh-CN": "适配器与运行时数据不一致。"
  },
  "m143": {
    "ru": "Конфигурация изменилась. Обновите статус и запустите новую проверку.",
    "en": "Configuration changed. Refresh status and run a new check.",
    "zh-CN": "配置已更改。请刷新状态并重新检查。"
  },
  "m144": {
    "ru": "В панели уже выполняется проверка клиента.",
    "en": "A client check is already running in the dashboard.",
    "zh-CN": "面板中已有客户端检查正在运行。"
  },
  "m145": {
    "ru": "Процесс завершился с ошибкой. Его исходный вывод не возвращается.",
    "en": "Process failed. Its raw output is not returned.",
    "zh-CN": "进程失败。不返回原始输出。"
  },
  "m146": {
    "ru": "MCP ответил, но данные RAG или идентичности проекта недоступны. Полная работоспособность памяти не подтверждена.",
    "en": "MCP responded, but RAG or project identity data is unavailable. Full memory operation is unconfirmed.",
    "zh-CN": "MCP 已响应，但 RAG 或项目标识数据不可用。尚未确认记忆功能完全正常。"
  },
  "m147": {
    "ru": "Не удалось получить состояние клиента. Обновите статус.",
    "en": "Could not read client status. Refresh status.",
    "zh-CN": "无法读取客户端状态。请刷新状态。"
  },
  "m148": {
    "ru": "{0} · {1} · {2} мс{3}{4}",
    "en": "{0} · {1} · {2} ms{3}{4}",
    "zh-CN": "{0} · {1} · {2} 毫秒{3}{4}"
  },
  "m149": {
    "ru": "Версия CLI",
    "en": "CLI version",
    "zh-CN": "CLI 版本"
  },
  "m150": {
    "ru": "Адаптер памяти",
    "en": "Memory adapter",
    "zh-CN": "记忆适配器"
  },
  "m151": {
    "ru": " · {0} MCP-инструментов",
    "en": " · {0} MCP tools",
    "zh-CN": " · {0} 个 MCP 工具"
  },
  "m152": {
    "ru": "Проверка не завершилась. Обновите статус.",
    "en": "Check did not finish. Refresh status.",
    "zh-CN": "检查未完成。请刷新状态。"
  },
  "m153": {
    "ru": "Клиентский список подтвердил enabled marketplace-плагин; результат проверки установленного адаптера приведён ниже.",
    "en": "Client listing confirmed an enabled marketplace plugin; the installed adapter check is shown below.",
    "zh-CN": "客户端列表已确认 marketplace 插件启用；下方显示已安装适配器的检查结果。"
  },
  "m154": {
    "ru": "Активная сессия, автоматическая доставка инструкций и использование агентом: нет данных.",
    "en": "Active session, automatic instruction delivery and agent usage: no data.",
    "zh-CN": "活动会话、自动指令传递及代理使用情况：无数据。"
  },
  "m155": {
    "ru": "Источник: локальные файлы и PATH. {0}.",
    "en": "Source: local files and PATH. {0}.",
    "zh-CN": "来源：本地文件和 PATH。{0}。"
  },
  "m156": {
    "ru": "Каталог панели: {0}",
    "en": "Dashboard directory: {0}",
    "zh-CN": "面板目录：{0}"
  },
  "m157": {
    "ru": "Файлы недоступны ({0}). Другие клиенты доступны отдельно.",
    "en": "Files unavailable ({0}). Other clients are available separately.",
    "zh-CN": "文件不可用（{0}）。其他客户端可单独访问。"
  },
  "m158": {
    "ru": "Глобальный MCP: {0} · marketplace: {1} · проектная регистрация: {2}",
    "en": "Global MCP: {0} · marketplace: {1} · project registration: {2}",
    "zh-CN": "全局 MCP：{0} · marketplace：{1} · 项目注册：{2}"
  },
  "m159": {
    "ru": "принадлежит плагину",
    "en": "owned by plugin",
    "zh-CN": "属于插件"
  },
  "m160": {
    "ru": "выключен",
    "en": "disabled",
    "zh-CN": "已停用"
  },
  "m161": {
    "ru": "не найден",
    "en": "not found",
    "zh-CN": "未找到"
  },
  "m162": {
    "ru": "включён в конфигурации",
    "en": "enabled in configuration",
    "zh-CN": "已在配置中启用"
  },
  "m163": {
    "ru": "не включён",
    "en": "not enabled",
    "zh-CN": "未启用"
  },
  "m164": {
    "ru": "найдена",
    "en": "found",
    "zh-CN": "已找到"
  },
  "m165": {
    "ru": "не найдена",
    "en": "not found",
    "zh-CN": "未找到"
  },
  "m166": {
    "ru": "Найдено несколько каналов/регистраций. Проверка адаптера заблокирована до устранения конфликта.",
    "en": "Multiple channels/registrations found. Adapter check blocked until the conflict is resolved.",
    "zh-CN": "发现多个渠道或注册。解决冲突前无法检查适配器。"
  },
  "m167": {
    "ru": "Регистрация memory-agent принадлежит другому приложению. Её команда не запускается.",
    "en": "The memory-agent registration belongs to another application. Its command is not run.",
    "zh-CN": "memory-agent 注册属于其他应用。不会运行其命令。"
  },
  "m168": {
    "ru": "Каналы marketplace и прямого MCP присутствуют одновременно.",
    "en": "Marketplace and direct MCP channels both exist.",
    "zh-CN": "marketplace 和直接 MCP 渠道同时存在。"
  },
  "m169": {
    "ru": "файл есть; владение не проверено",
    "en": "file exists; ownership unchecked",
    "zh-CN": "文件存在；未检查归属"
  },
  "m170": {
    "ru": "файла нет",
    "en": "file absent",
    "zh-CN": "文件不存在"
  },
  "m171": {
    "ru": "native-контекст OpenCode",
    "en": "OpenCode native context",
    "zh-CN": "OpenCode 原生上下文"
  },
  "m172": {
    "ru": "managed-блок есть",
    "en": "managed block present",
    "zh-CN": "存在受管区块"
  },
  "m173": {
    "ru": "managed-блока нет",
    "en": "managed block absent",
    "zh-CN": "不存在受管区块"
  },
  "m174": {
    "ru": "Executable в PATH: {0}",
    "en": "Executable in PATH: {0}",
    "zh-CN": "PATH 中的可执行文件：{0}"
  },
  "m175": {
    "ru": "Для Antigravity native CLI-проверка не поддерживается.",
    "en": "Antigravity native CLI check is unsupported.",
    "zh-CN": "不支持 Antigravity 原生 CLI 检查。"
  },
  "m176": {
    "ru": "Установка и загрузка в активную сессию не подтверждены чтением конфигурации.",
    "en": "Reading configuration does not confirm installation or loading into an active session.",
    "zh-CN": "读取配置不能确认安装情况或是否已加载到活动会话。"
  },
  "m177": {
    "ru": "Проверенные файлы и версии",
    "en": "Checked files and versions",
    "zh-CN": "已检查的文件和版本"
  },
  "m178": {
    "ru": "отсутствует",
    "en": "missing",
    "zh-CN": "缺失"
  },
  "m179": {
    "ru": "Читаем локальные файлы…",
    "en": "Reading local files…",
    "zh-CN": "正在读取本地文件…"
  },
  "m180": {
    "ru": "Выполняется отдельный процесс проверки. Лимит — 20 секунд…",
    "en": "Running a separate check process. Limit: 20 seconds…",
    "zh-CN": "正在独立进程中检查。限时 20 秒…"
  },
  "m181": {
    "ru": "<span class=\"image-description\">{0} (изображение)</span>",
    "en": "<span class=\"image-description\">{0} (image)</span>",
    "zh-CN": "<span class=\"image-description\">{0}（图片）</span>"
  },
  "m182": {
    "ru": "Изображение",
    "en": "Image",
    "zh-CN": "图片"
  },
  "m183": {
    "ru": "<figure class=\"diagram\" data-diagram=\"{0}\"><div class=\"diagram-output\" role=\"img\" aria-label=\"Диаграмма Mermaid\"></div><details><summary>Код диаграммы</summary><pre><code>{1}</code></pre></details></figure>",
    "en": "<figure class=\"diagram\" data-diagram=\"{0}\"><div class=\"diagram-output\" role=\"img\" aria-label=\"Mermaid diagram\"></div><details><summary>Diagram code</summary><pre><code>{1}</code></pre></details></figure>",
    "zh-CN": "<figure class=\"diagram\" data-diagram=\"{0}\"><div class=\"diagram-output\" role=\"img\" aria-label=\"Mermaid 图表\"></div><details><summary>图表代码</summary><pre><code>{1}</code></pre></details></figure>"
  },
  "m184": {
    "ru": "Диаграмма содержит неподдерживаемые настройки или превышает лимит. Доступен исходный код.",
    "en": "Diagram settings unsupported or limit exceeded. Source code is available.",
    "zh-CN": "图表包含不支持的设置或超出限制。可查看源代码。"
  },
  "m185": {
    "ru": "Диаграмма Mermaid",
    "en": "Mermaid diagram",
    "zh-CN": "Mermaid 图表"
  },
  "m186": {
    "ru": "Не удалось отобразить Mermaid. Проверьте код диаграммы.",
    "en": "Could not render Mermaid. Check the diagram code.",
    "zh-CN": "无法渲染 Mermaid。请检查图表代码。"
  },
  "m187": {
    "ru": "Большой фрагмент показан исходным текстом.",
    "en": "Large block shown as source text.",
    "zh-CN": "大段内容以原文显示。"
  },
  "m188": {
    "ru": "Строим диаграмму…",
    "en": "Rendering diagram…",
    "zh-CN": "正在绘制图表…"
  },
  "m189": {
    "ru": "Оформление недоступно; показан исходный текст.",
    "en": "Formatting unavailable; showing source text.",
    "zh-CN": "无法显示格式；正在显示原文。"
  },
  "m190": {
    "ru": "Показать оформление",
    "en": "Show formatted content",
    "zh-CN": "显示格式化内容"
  },
  "m191": {
    "ru": "Показать исходный текст",
    "en": "Show source text",
    "zh-CN": "显示原文"
  },
  "m192": {
    "ru": "Проверка движка",
    "en": "Engine check",
    "zh-CN": "引擎检查"
  },
  "m193": {
    "ru": "Очистка файлов",
    "en": "File cleanup",
    "zh-CN": "文件清理"
  },
  "m194": {
    "ru": "Восстановление файлов",
    "en": "File recovery",
    "zh-CN": "文件恢复"
  },
  "m195": {
    "ru": "Продолжение очистки",
    "en": "Resume cleanup",
    "zh-CN": "继续清理"
  },
  "m196": {
    "ru": "Отдельное временное хранилище",
    "en": "Isolated temporary store",
    "zh-CN": "独立临时存储"
  },
  "m197": {
    "ru": "Запись и чтение Notebook",
    "en": "Notebook write and readback",
    "zh-CN": "Notebook 写入与回读"
  },
  "m198": {
    "ru": "Связь с источником и проекция в графе",
    "en": "Source link and graph projection",
    "zh-CN": "来源关联及图谱投影"
  },
  "m199": {
    "ru": "Текст сохранённого источника",
    "en": "Saved source text",
    "zh-CN": "已保存的来源正文"
  },
  "m200": {
    "ru": "Поиск без загрузки моделей",
    "en": "Search without loading models",
    "zh-CN": "不加载模型的搜索"
  },
  "m201": {
    "ru": "файлов",
    "en": "files",
    "zh-CN": "个文件"
  },
  "m202": {
    "ru": "файл",
    "en": "file",
    "zh-CN": "个文件"
  },
  "m203": {
    "ru": "файла",
    "en": "files",
    "zh-CN": "个文件"
  },
  "m204": {
    "ru": "Файлы, привязки или состояние восстановления изменились. Обновите состояние и проверьте список снова.",
    "en": "Files, references or recovery state changed. Refresh status and check the list again.",
    "zh-CN": "文件、引用或恢复状态已更改。请刷新状态并重新检查列表。"
  },
  "m205": {
    "ru": "Ошибка",
    "en": "Error",
    "zh-CN": "错误"
  },
  "m206": {
    "ru": "Проверка выполняется в отдельном процессе с временной памятью. Создаёт тестовый Notebook, источник и связь, читает текст и проверяет поиск. Модели и облако не используются. Временная память удаляется после проверки; это не проверка активной сессии клиента.",
    "en": "Runs in a separate process with temporary memory. Creates a test Notebook, source and link, reads text and checks search. No models or cloud used. Temporary memory is removed afterward; this does not check an active client session.",
    "zh-CN": "在独立进程中使用临时记忆运行。创建测试 Notebook、来源和关联，读取正文并检查搜索。不使用模型或云端。完成后删除临时记忆；此检查不验证活动客户端会话。"
  },
  "m207": {
    "ru": "Файлы всех локальных областей RAG. Notebook, индекс, модели, файлы клиентов и история снимков сохраняются. Неиспользуемые файлы резервируются в проверенный ZIP. Уменьшение рабочего хранилища не означает освобождение того же объёма на диске: ZIP остаётся для восстановления.",
    "en": "Files across all local RAG scopes. Notebook, index, models, client files and snapshot history remain. Unused files are backed up to a verified ZIP. Reducing active storage does not reclaim the same disk space: the recovery ZIP remains.",
    "zh-CN": "涉及所有本地 RAG 范围的文件。Notebook、索引、模型、客户端文件和快照历史均保留。未使用文件备份到已验证的 ZIP。工作存储减少不代表释放同等磁盘空间：恢复 ZIP 仍会保留。"
  },
  "m208": {
    "ru": " Есть незавершённая операция: выберите её квитанцию и продолжите очистку либо восстановите файлы.",
    "en": " An operation is unfinished: select its receipt and resume cleanup or restore files.",
    "zh-CN": " 存在未完成操作：请选择其回执，继续清理或恢复文件。"
  },
  "m209": {
    "ru": "Запустить проверку",
    "en": "Run check",
    "zh-CN": "运行检查"
  },
  "m210": {
    "ru": "Проверить список файлов",
    "en": "Review file list",
    "zh-CN": "检查文件列表"
  },
  "m211": {
    "ru": "Неиспользуемые файлы: {0}. Рабочий объём: {1} байт. Пропущено: {2}. Проверено: {3}.",
    "en": "Unused files: {0}. Active size: {1} bytes. Skipped: {2}. Checked: {3}.",
    "zh-CN": "未使用文件：{0}。工作大小：{1} 字节。已跳过：{2}。检查时间：{3}。"
  },
  "m212": {
    "ru": "{0}: квитанция недоступна ({1})",
    "en": "{0}: receipt unavailable ({1})",
    "zh-CN": "{0}：回执不可用（{1}）"
  },
  "m213": {
    "ru": "{0} · {1} / {2} · обработано {3} · {4} · ZIP: {5}",
    "en": "{0} · {1} / {2} · processed {3} · {4} · ZIP: {5}",
    "zh-CN": "{0} · {1} / {2} · 已处理 {3} · {4} · ZIP：{5}"
  },
  "m214": {
    "ru": "Состояние файлов недоступно. Изолированная проверка движка остаётся доступной.",
    "en": "File status unavailable. The isolated engine check is still available.",
    "zh-CN": "文件状态不可用。仍可运行独立引擎检查。"
  },
  "m215": {
    "ru": "Проверка во временном хранилище…",
    "en": "Checking temporary storage…",
    "zh-CN": "正在检查临时存储…"
  },
  "m216": {
    "ru": "Проверяется список файлов…",
    "en": "Checking file list…",
    "zh-CN": "正在检查文件列表…"
  },
  "m217": {
    "ru": "Проверка движка пройдена",
    "en": "Engine check passed",
    "zh-CN": "引擎检查通过"
  },
  "m218": {
    "ru": "Проверка движка не пройдена",
    "en": "Engine check failed",
    "zh-CN": "引擎检查失败"
  },
  "m219": {
    "ru": "пройдено",
    "en": "passed",
    "zh-CN": "通过"
  },
  "m220": {
    "ru": "Рабочая память не изменялась. Временное хранилище: {0}. Проверено: {1}.",
    "en": "Working memory unchanged. Temporary store: {0}. Checked: {1}.",
    "zh-CN": "工作记忆未更改。临时存储：{0}。检查时间：{1}。"
  },
  "m221": {
    "ru": "удалено",
    "en": "removed",
    "zh-CN": "已删除"
  },
  "m222": {
    "ru": "очистка не подтверждена",
    "en": "cleanup unconfirmed",
    "zh-CN": "未确认清理完成"
  },
  "m223": {
    "ru": "Рабочий объём: {0} байт. {1}",
    "en": "Active size: {0} bytes. {1}",
    "zh-CN": "工作大小：{0} 字节。{1}"
  },
  "m224": {
    "ru": "Будут восстановлены отсутствующие файлы.",
    "en": "Missing files will be restored.",
    "zh-CN": "将恢复缺失文件。"
  },
  "m225": {
    "ru": "Будут убраны перечисленные неиспользуемые файлы; резервный ZIP сохранится.",
    "en": "Listed unused files will be removed; the backup ZIP will remain.",
    "zh-CN": "将移除所列未使用文件；备份 ZIP 将保留。"
  },
  "m226": {
    "ru": "{0} · {1} байт",
    "en": "{0} · {1} bytes",
    "zh-CN": "{0} · {1} 字节"
  },
  "m227": {
    "ru": "Пропущено: {0}",
    "en": "Skipped: {0}",
    "zh-CN": "已跳过：{0}"
  },
  "m228": {
    "ru": "Неиспользуемых файлов нет.",
    "en": "No unused files.",
    "zh-CN": "没有未使用文件。"
  },
  "m229": {
    "ru": "Изменять файлы не требуется. Подтверждение завершит восстановление состояния операции.",
    "en": "No file changes needed. Confirmation will finish recovering the operation state.",
    "zh-CN": "无需更改文件。确认后将完成操作状态恢复。"
  },
  "m230": {
    "ru": "Выполняется подтверждённая операция…",
    "en": "Running confirmed operation…",
    "zh-CN": "正在执行已确认的操作…"
  },
  "m231": {
    "ru": "{0}. Обработано: {1}. Квитанция: {2}. ZIP: {3}.",
    "en": "{0}. Processed: {1}. Receipt: {2}. ZIP: {3}.",
    "zh-CN": "{0}。已处理：{1}。回执：{2}。ZIP：{3}。"
  },
  "m232": {
    "ru": "Выполнено",
    "en": "Completed",
    "zh-CN": "已完成"
  },
  "m233": {
    "ru": "Выполнено частично",
    "en": "Partially completed",
    "zh-CN": "部分完成"
  },
  "m234": {
    "ru": "не нужна",
    "en": "not needed",
    "zh-CN": "不需要"
  },
  "m235": {
    "ru": "не нужен",
    "en": "not needed",
    "zh-CN": "不需要"
  },
  "m236": {
    "ru": "Ответ мог быть потерян. Обновите состояние и проверьте квитанции перед повтором операции.",
    "en": "Response may have been lost. Refresh status and inspect receipts before retrying.",
    "zh-CN": "响应可能丢失。请刷新状态并检查回执后再重试。"
  },
  "m237": {
    "ru": "Такой текст уже есть в целевом хранилище. Измените цель или разберите совпадение отдельно.",
    "en": "This text already exists in the destination store. Change destination or review the duplicate separately.",
    "zh-CN": "目标存储中已有此正文。请更改目标或单独处理重复内容。"
  },
  "m238": {
    "ru": "В целевом хранилище повторяются ID; сначала исправьте их.",
    "en": "Destination store has duplicate IDs; fix them first.",
    "zh-CN": "目标存储中有重复 ID；请先修复。"
  },
  "m239": {
    "ru": "Перенос одной записи разделит историю замещения. Перенос цепочки пока недоступен.",
    "en": "Moving one record would split replacement history. Moving a chain is not supported yet.",
    "zh-CN": "移动单条记录会拆分替代历史。暂不支持移动记录链。"
  },
  "m240": {
    "ru": "ID записи уже упоминается в истории целевого хранилища.",
    "en": "Record ID is already referenced in the destination history.",
    "zh-CN": "目标历史中已引用该记录 ID。"
  },
  "m241": {
    "ru": "Есть неоднозначные старые связи. Сначала разберите их в редакторе связей.",
    "en": "Ambiguous legacy links exist. Review them in the link editor first.",
    "zh-CN": "存在不明确的旧关联。请先在关联编辑器中处理。"
  },
  "m242": {
    "ru": "Связанный источник недоступен в исходной области.",
    "en": "Linked source unavailable in the original scope.",
    "zh-CN": "关联来源在原范围内不可用。"
  },
  "m243": {
    "ru": "Связанный источник не виден в целевой области. Для переноса разрешите открыть перечисленные источники целевой области.",
    "en": "Linked source is invisible in the destination scope. Allow the listed sources to be shared with the destination before moving.",
    "zh-CN": "关联来源在目标范围内不可见。移动前请允许向目标范围开放所列来源。"
  },
  "m244": {
    "ru": "Есть независимые графовые связи. Их автоматический перенос не поддерживается.",
    "en": "Independent graph links exist. Automatic transfer is unsupported.",
    "zh-CN": "存在独立图谱关联。不支持自动移动。"
  },
  "m245": {
    "ru": "Есть неоднозначные старые графовые связи; сначала разберите их.",
    "en": "Ambiguous legacy graph links exist; review them first.",
    "zh-CN": "存在不明确的旧图谱关联；请先处理。"
  },
  "m246": {
    "ru": "Данные изменились. Обновите предпросмотр. Если изменилась сама инструкция, откройте её заново из свежего списка.",
    "en": "Data changed. Refresh the preview. If the instruction changed, reopen it from a fresh list.",
    "zh-CN": "数据已更改。请刷新预览。若指令本身已更改，请从最新列表重新打开。"
  },
  "m247": {
    "ru": "Сначала подготовьте связи через «Добавить связь с источником → Подготовить связи». Перенос не запускает миграцию автоматически.",
    "en": "First use Add source link → Prepare links. Moving does not automatically run migration.",
    "zh-CN": "请先执行“添加来源关联 → 准备关联”。移动不会自动执行迁移。"
  },
  "m248": {
    "ru": "Публикация прервана. Проверьте обе области после восстановления движка; повторный перенос автоматически не выполняется.",
    "en": "Publication interrupted. Check both scopes after engine recovery; the move is not automatically retried.",
    "zh-CN": "发布已中断。引擎恢复后请检查两个范围；不会自动重试移动。"
  },
  "m249": {
    "ru": "{0}: {1}. При ошибке применения обновите обе области: перенос мог уже сохраниться.",
    "en": "{0}: {1}. If apply failed, refresh both scopes: the move may already be saved.",
    "zh-CN": "{0}：{1}。若应用失败，请刷新两个范围：移动可能已保存。"
  },
  "m250": {
    "ru": "Из: {0} · {1} · {2}",
    "en": "From: {0} · {1} · {2}",
    "zh-CN": "从：{0} · {1} · {2}"
  },
  "m251": {
    "ru": "В: {0} · {1} · {2}",
    "en": "To: {0} · {1} · {2}",
    "zh-CN": "到：{0} · {1} · {2}"
  },
  "m252": {
    "ru": "ID изменится: {0} → {1}.",
    "en": "ID will change: {0} → {1}.",
    "zh-CN": "ID 将更改：{0} → {1}。"
  },
  "m253": {
    "ru": "legacy без ID",
    "en": "legacy without ID",
    "zh-CN": "无 ID 的旧记录"
  },
  "m254": {
    "ru": "ID сохранится.",
    "en": "ID will be preserved.",
    "zh-CN": "ID 将保留。"
  },
  "m255": {
    "ru": "Дата, TTL, защита, выключенное состояние и теги сохранятся.",
    "en": "Date, TTL, protection, disabled state and tags will be preserved.",
    "zh-CN": "日期、TTL、保护、停用状态和标签将保留。"
  },
  "m256": {
    "ru": "Связей будет перенесено: {0}. Прежние области документов сохранятся.",
    "en": "Links to move: {0}. Existing document scopes will remain.",
    "zh-CN": "将移动的关联：{0}。现有文档范围将保留。"
  },
  "m257": {
    "ru": "Перед применением будет создан проверенный локальный резервный ZIP.",
    "en": "A verified local backup ZIP will be created before applying.",
    "zh-CN": "应用前将创建并验证本地备份 ZIP。"
  },
  "m258": {
    "ru": "Активная сессия может хранить прежний контекст; передача в неё и использование агентом не наблюдались.",
    "en": "An active session may retain old context; delivery to it and agent usage have not been observed.",
    "zh-CN": "活动会话可能保留旧上下文；尚未观测到传递或代理使用情况。"
  },
  "m259": {
    "ru": "{0}: {1}. Текущие области: {2}.",
    "en": "{0}: {1}. Current scopes: {2}.",
    "zh-CN": "{0}：{1}。当前范围：{2}。"
  },
  "m260": {
    "ru": "открыть области {0}",
    "en": "share with scope {0}",
    "zh-CN": "向范围 {0} 开放"
  },
  "m261": {
    "ru": "доступ в целевой области уже есть",
    "en": "destination already has access",
    "zh-CN": "目标范围已有访问权限"
  },
  "m262": {
    "ru": "доступа в целевой области нет",
    "en": "destination has no access",
    "zh-CN": "目标范围无访问权限"
  },
  "m263": {
    "ru": "Глобальная область откроет эти источники всем проектам, использующим глобальные знания.",
    "en": "The global scope will expose these sources to all projects using global knowledge.",
    "zh-CN": "全局范围将向所有使用全局知识的项目开放这些来源。"
  },
  "m264": {
    "ru": "Проверьте обе области и последствия, затем подтвердите перенос.",
    "en": "Review both scopes and consequences, then confirm the move.",
    "zh-CN": "请检查两个范围及影响，然后确认移动。"
  },
  "m265": {
    "ru": "Перенос заблокирован перечисленными конфликтами. Измените цель или устраните причины и обновите предпросмотр.",
    "en": "Move blocked by the listed conflicts. Change destination or resolve them and refresh the preview.",
    "zh-CN": "所列冲突阻止移动。请更改目标或解决冲突后刷新预览。"
  },
  "m266": {
    "ru": "Выберите целевое хранилище.",
    "en": "Select a destination store.",
    "zh-CN": "请选择目标存储。"
  },
  "m267": {
    "ru": "Обновите предпросмотр для выбранной цели.",
    "en": "Refresh the preview for this destination.",
    "zh-CN": "请刷新此目标的预览。"
  },
  "m268": {
    "ru": "Обновите предпросмотр после изменения доступа источников.",
    "en": "Refresh preview after changing source access.",
    "zh-CN": "更改来源访问权限后请刷新预览。"
  },
  "m269": {
    "ru": "Прежний предпросмотр сброшен. Проверьте состояние и обновите его перед повторным применением.",
    "en": "Previous preview cleared. Check status and refresh before applying again.",
    "zh-CN": "旧预览已清除。再次应用前请检查状态并刷新。"
  },
  "m270": {
    "ru": "Исходная область: {0} · {1}",
    "en": "Original scope: {0} · {1}",
    "zh-CN": "原范围：{0} · {1}"
  },
  "m271": {
    "ru": "Выберите цель и проверьте предпросмотр.",
    "en": "Select a destination and review the preview.",
    "zh-CN": "请选择目标并检查预览。"
  },
  "m272": {
    "ru": "Выберите хранилище…",
    "en": "Select a store…",
    "zh-CN": "选择存储…"
  },
  "m273": {
    "ru": "Источник или чанк недоступен в выбранной области.",
    "en": "Source or chunk unavailable in the selected scope.",
    "zh-CN": "来源或分块在所选范围内不可用。"
  },
  "m274": {
    "ru": "Хранилище занято. Повторите чтение через несколько секунд.",
    "en": "Storage busy. Retry reading in a few seconds.",
    "zh-CN": "存储繁忙。请稍后重试读取。"
  },
  "m275": {
    "ru": "Источник изменился. Откройте его заново, чтобы прочитать текущую ревизию.",
    "en": "Source changed. Reopen it to read the current revision.",
    "zh-CN": "来源已更改。请重新打开以读取当前修订。"
  },
  "m276": {
    "ru": "Не удалось прочитать знания. Проверьте локальное хранилище и повторите действие.",
    "en": "Could not read knowledge. Check local storage and try again.",
    "zh-CN": "无法读取知识。请检查本地存储并重试。"
  },
  "m277": {
    "ru": "Читаем сохранённые источники…",
    "en": "Reading saved sources…",
    "zh-CN": "正在读取已保存的来源…"
  },
  "m278": {
    "ru": "{0}–{1} из {2}",
    "en": "{0}–{1} of {2}",
    "zh-CN": "第 {0}–{1} 项，共 {2} 项"
  },
  "m279": {
    "ru": "В выбранной области источников не найдено.",
    "en": "No sources found in the selected scope.",
    "zh-CN": "所选范围内未找到来源。"
  },
  "m280": {
    "ru": "Источник · {0}",
    "en": "Source · {0}",
    "zh-CN": "来源 · {0}"
  },
  "m281": {
    "ru": "Данные недоступны. Повторите поиск.",
    "en": "Data unavailable. Retry search.",
    "zh-CN": "数据不可用。请重新搜索。"
  },
  "m282": {
    "ru": "Читаем источник…",
    "en": "Reading source…",
    "zh-CN": "正在读取来源…"
  },
  "m283": {
    "ru": "Происхождение",
    "en": "Provenance",
    "zh-CN": "出处"
  },
  "m284": {
    "ru": "Вид Note",
    "en": "Note kind",
    "zh-CN": "笔记类型"
  },
  "m285": {
    "ru": "Путь источника",
    "en": "Source path",
    "zh-CN": "来源路径"
  },
  "m286": {
    "ru": "Видимые области",
    "en": "Visible scopes",
    "zh-CN": "可见范围"
  },
  "m287": {
    "ru": "Общий документ",
    "en": "Shared document",
    "zh-CN": "共享文档"
  },
  "m288": {
    "ru": "Да · других областей: {0}",
    "en": "Yes · other scopes: {0}",
    "zh-CN": "是 · 其他范围：{0}"
  },
  "m289": {
    "ru": "Создан",
    "en": "Created",
    "zh-CN": "创建时间"
  },
  "m290": {
    "ru": "Изменён",
    "en": "Modified",
    "zh-CN": "修改时间"
  },
  "m291": {
    "ru": "Ревизия чтения",
    "en": "Read revision",
    "zh-CN": "读取修订"
  },
  "m292": {
    "ru": "Индекс",
    "en": "Index",
    "zh-CN": "索引"
  },
  "m293": {
    "ru": "{0} · {1}/{2} micro-чанков с вектором · модель {3}",
    "en": "{0} · {1}/{2} micro chunks with vectors · model {3}",
    "zh-CN": "{0} · {1}/{2} 个微分块有向量 · 模型 {3}"
  },
  "m294": {
    "ru": "Для изменения выберите область, которая владеет документом.",
    "en": "Select the document's owning scope to edit.",
    "zh-CN": "请选择文档所属范围以编辑。"
  },
  "m295": {
    "ru": "Ограничение",
    "en": "Limit",
    "zh-CN": "限制"
  },
  "m296": {
    "ru": "Длинные метаданные показаны частично.",
    "en": "Long metadata shown partially.",
    "zh-CN": "较长元数据仅显示部分内容。"
  },
  "m297": {
    "ru": "Открыта запрошенная строка {0}. Актуальность legacy-связи требует проверки.",
    "en": "Opened requested line {0}. Legacy link freshness needs review.",
    "zh-CN": "已打开请求的第 {0} 行。旧关联是否仍有效需要检查。"
  },
  "m298": {
    "ru": "Нормализованный сохранённый текст. Нумерация строк с 1; CRLF и CR приводятся к LF.",
    "en": "Saved normalized text. Lines start at 1; CRLF and CR become LF.",
    "zh-CN": "已保存的规范化正文。行号从 1 开始；CRLF 和 CR 统一为 LF。"
  },
  "m299": {
    "ru": "Источник недоступен",
    "en": "Source unavailable",
    "zh-CN": "来源不可用"
  },
  "m300": {
    "ru": "Строки {0}–{1} из {2}{3}",
    "en": "Lines {0}–{1} of {2}{3}",
    "zh-CN": "第 {0}–{1} 行，共 {2} 行{3}"
  },
  "m301": {
    "ru": " · показан фрагмент",
    "en": " · partial text shown",
    "zh-CN": " · 仅显示部分正文"
  },
  "m302": {
    "ru": "Сохранённый blob отсутствует.",
    "en": "Saved blob missing.",
    "zh-CN": "已保存的数据块缺失。"
  },
  "m303": {
    "ru": "Сохранённый blob повреждён.",
    "en": "Saved blob corrupted.",
    "zh-CN": "已保存的数据块损坏。"
  },
  "m304": {
    "ru": "Текст превышает лимит просмотра 16 МиБ.",
    "en": "Text exceeds the 16 MiB preview limit.",
    "zh-CN": "正文超过 16 MiB 预览限制。"
  },
  "m305": {
    "ru": "Текст недоступен.",
    "en": "Text unavailable.",
    "zh-CN": "正文不可用。"
  },
  "m306": {
    "ru": "{0} {1} · {2} · порядок по ID; координаты исходника UNKNOWN",
    "en": "{0} {1} · {2} · ordered by ID; source coordinates UNKNOWN",
    "zh-CN": "{0} {1} · {2} · 按 ID 排序；来源坐标 UNKNOWN"
  },
  "m307": {
    "ru": "родитель {0}",
    "en": "parent {0}",
    "zh-CN": "父项 {0}"
  },
  "m308": {
    "ru": "весь документ",
    "en": "whole document",
    "zh-CN": "整个文档"
  },
  "m309": {
    "ru": " {0} токенов · родитель {1} · {2}",
    "en": " {0} tokens · parent {1} · {2}",
    "zh-CN": " {0} 个 token · 父项 {1} · {2}"
  },
  "m310": {
    "ru": "Medium-чанки",
    "en": "Medium chunks",
    "zh-CN": "中分块"
  },
  "m311": {
    "ru": "Micro-чанки",
    "en": "Micro chunks",
    "zh-CN": "微分块"
  },
  "m312": {
    "ru": "section: {0} · medium: {1} · {2} · policy_source: {3}\n{4}\n{5}\nКоординаты в raw: UNKNOWN ({6})",
    "en": "section: {0} · medium: {1} · {2} · policy_source: {3}\n{4}\n{5}\nRaw coordinates: UNKNOWN ({6})",
    "zh-CN": "section：{0} · medium：{1} · {2} · policy_source：{3}\n{4}\n{5}\n原文坐标：UNKNOWN（{6}）"
  },
  "m313": {
    "ru": "Вектор: {0}; модель {1} ({2})",
    "en": "Vector: {0}; model {1} ({2})",
    "zh-CN": "向量：{0}；模型 {1}（{2}）"
  },
  "m314": {
    "ru": "{0} байт, {1} измерений",
    "en": "{0} bytes, {1} dimensions",
    "zh-CN": "{0} 字节，{1} 维"
  },
  "m315": {
    "ru": "Связанных фактов в этом контексте нет.",
    "en": "No linked facts in this context.",
    "zh-CN": "此上下文中没有关联事实。"
  },
  "m316": {
    "ru": " · {0} строки {1}–{2}",
    "en": " · {0} lines {1}–{2}",
    "zh-CN": " · {0} 第 {1}–{2} 行"
  },
  "m317": {
    "ru": "подтверждены",
    "en": "confirmed",
    "zh-CN": "已确认"
  },
  "m318": {
    "ru": "запрошены",
    "en": "requested",
    "zh-CN": "已请求"
  },
  "m319": {
    "ru": "Данные изменились. Черновик сохранён. Нажмите «Обновить версию», сравните сохранённый текст и снова подготовьте правку.",
    "en": "Data changed. Draft retained. Click Refresh version, compare saved text and prepare the edit again.",
    "zh-CN": "数据已更改。草稿已保留。请点击“刷新版本”，比较已保存正文后重新准备编辑。"
  },
  "m320": {
    "ru": "Для редактирования сначала подготовьте хранилище с резервной копией.",
    "en": "Prepare storage with a backup before editing.",
    "zh-CN": "编辑前请先备份并准备存储。"
  },
  "m321": {
    "ru": "Подтвердите изменение всех областей общего документа.",
    "en": "Confirm changes across all scopes of the shared document.",
    "zh-CN": "请确认更改共享文档的所有范围。"
  },
  "m322": {
    "ru": "Выбранная область не владеет этим документом.",
    "en": "The selected scope does not own this document.",
    "zh-CN": "所选范围不拥有此文档。"
  },
  "m323": {
    "ru": "Сохранённый текст недоступен редактору: проверьте источник, размер и тип.",
    "en": "Saved text unavailable to the editor: check source, size and type.",
    "zh-CN": "编辑器无法获取已保存正文：请检查来源、大小和类型。"
  },
  "m324": {
    "ru": "Подготовка или сохранение не завершены. Черновик остаётся здесь; можно повторить подготовку с текстовым индексом.",
    "en": "Preparation or save incomplete. Your draft stays here; you can retry using a text-only index.",
    "zh-CN": "准备或保存未完成。草稿保留在此处；可使用纯文本索引重试。"
  },
  "m325": {
    "ru": "Подготовка прочитает файл: {0}. Просмотр сохранённого документа файл не обновляет.",
    "en": "Preparation will read file: {0}. Viewing a saved document does not refresh the file.",
    "zh-CN": "准备时将读取文件：{0}。查看已保存文档不会更新该文件。"
  },
  "m326": {
    "ru": "Подготовка загрузит URL: {0}. Обновление действует во всех областях документа.",
    "en": "Preparation will fetch URL: {0}. The update affects all document scopes.",
    "zh-CN": "准备时将获取 URL：{0}。更新将影响文档的所有范围。"
  },
  "m327": {
    "ru": "Сохранено сейчас: {0} · вид {1} · теги {2} · индекс {3}. Нетронутые поля обновлены, ваши изменённые поля сохранены.",
    "en": "Currently saved: {0} · kind {1} · tags {2} · index {3}. Untouched fields refreshed; your edited fields retained.",
    "zh-CN": "当前已保存：{0} · 类型 {1} · 标签 {2} · 索引 {3}。未修改字段已刷新，已编辑字段已保留。"
  },
  "m328": {
    "ru": "без тегов",
    "en": "no tags",
    "zh-CN": "无标签"
  },
  "m329": {
    "ru": "Область: {0}",
    "en": "Scope: {0}",
    "zh-CN": "范围：{0}"
  },
  "m330": {
    "ru": "Новая Memory Note",
    "en": "New Memory Note",
    "zh-CN": "新建记忆笔记"
  },
  "m331": {
    "ru": "Редактирование Note",
    "en": "Edit Note",
    "zh-CN": "编辑笔记"
  },
  "m332": {
    "ru": "Добавить источник",
    "en": "Add source",
    "zh-CN": "添加来源"
  },
  "m333": {
    "ru": "Обновление источника",
    "en": "Update source",
    "zh-CN": "更新来源"
  },
  "m334": {
    "ru": "Метаданные документа",
    "en": "Document metadata",
    "zh-CN": "文档元数据"
  },
  "m335": {
    "ru": "Ожидает подготовки",
    "en": "Awaiting preparation",
    "zh-CN": "等待准备"
  },
  "m336": {
    "ru": "Читаем выбранный источник",
    "en": "Reading selected source",
    "zh-CN": "正在读取所选来源"
  },
  "m337": {
    "ru": "Нормализуем текст",
    "en": "Normalizing text",
    "zh-CN": "正在规范化正文"
  },
  "m338": {
    "ru": "Готовим векторы",
    "en": "Preparing vectors",
    "zh-CN": "正在准备向量"
  },
  "m339": {
    "ru": "Готовим текстовый индекс",
    "en": "Preparing text index",
    "zh-CN": "正在准备文本索引"
  },
  "m340": {
    "ru": "Ревизия готова к проверке",
    "en": "Revision ready for review",
    "zh-CN": "修订已准备好供检查"
  },
  "m341": {
    "ru": "Публикуем ревизию",
    "en": "Publishing revision",
    "zh-CN": "正在发布修订"
  },
  "m342": {
    "ru": "Сохранено",
    "en": "Saved",
    "zh-CN": "已保存"
  },
  "m343": {
    "ru": "Подготовка",
    "en": "Preparation",
    "zh-CN": "准备"
  },
  "m344": {
    "ru": " · {0}/{1} чанков",
    "en": " · {0}/{1} chunks",
    "zh-CN": " · {0}/{1} 个分块"
  },
  "m345": {
    "ru": "{0}\n{1} · {2}\n{3} · {4} micro-чанков\nОбластей документа: {5}{6}\nСвязей: {7}; требуют проверки: {8}{9}",
    "en": "{0}\n{1} · {2}\n{3} · {4} micro chunks\nDocument scopes: {5}{6}\nLinks: {7}; need review: {8}{9}",
    "zh-CN": "{0}\n{1} · {2}\n{3} · {4} 个微分块\n文档范围：{5}{6}\n关联：{7}；需要检查：{8}{9}"
  },
  "m346": {
    "ru": "Новый сохранённый текст",
    "en": "New saved text",
    "zh-CN": "新保存的正文"
  },
  "m347": {
    "ru": "Текст сохраняется",
    "en": "Text preserved",
    "zh-CN": "正文保持不变"
  },
  "m348": {
    "ru": "Индекс будет перестроен",
    "en": "Index will be rebuilt",
    "zh-CN": "将重建索引"
  },
  "m349": {
    "ru": "Индекс сохраняется",
    "en": "Index preserved",
    "zh-CN": "索引保持不变"
  },
  "m350": {
    "ru": "Текстовый индекс и векторы",
    "en": "Text index and vectors",
    "zh-CN": "文本索引和向量"
  },
  "m351": {
    "ru": "Текстовый индекс без векторов",
    "en": "Text index without vectors",
    "zh-CN": "不含向量的文本索引"
  },
  "m352": {
    "ru": "Происхождение прежнего индекса UNKNOWN",
    "en": "Previous index provenance UNKNOWN",
    "zh-CN": "旧索引出处 UNKNOWN"
  },
  "m353": {
    "ru": "; изменение действует во всех областях",
    "en": "; affects all scopes",
    "zh-CN": "；影响所有范围"
  },
  "m354": {
    "ru": "; связей других областей: {0} (частные данные скрыты)",
    "en": "; links in other scopes: {0} (private data hidden)",
    "zh-CN": "；其他范围的关联：{0}（私人数据已隐藏）"
  },
  "m355": {
    "ru": "раздел исчезнет",
    "en": "section will disappear",
    "zh-CN": "章节将消失"
  },
  "m356": {
    "ru": "точная привязка сохранена",
    "en": "exact reference preserved",
    "zh-CN": "精确引用已保留"
  },
  "m357": {
    "ru": "нужна проверка источника",
    "en": "source review needed",
    "zh-CN": "需要检查来源"
  },
  "m358": {
    "ru": "Оформление показывает первые 2000 символов подготовленного текста.",
    "en": "Formatted preview shows the first 2,000 characters of prepared text.",
    "zh-CN": "格式化预览显示已准备正文的前 2,000 个字符。"
  },
  "m359": {
    "ru": "Ревизия сохранена.",
    "en": "Revision saved.",
    "zh-CN": "修订已保存。"
  },
  "m360": {
    "ru": "Версия обновлена. Сравните сохранённый текст с черновиком перед новой подготовкой.",
    "en": "Version refreshed. Compare saved text with your draft before preparing again.",
    "zh-CN": "版本已刷新。再次准备前请对照已保存正文检查草稿。"
  },
  "m361": {
    "ru": "Подготовка отброшена; сохранённый документ не изменён. Уже начатый запрос может завершиться.",
    "en": "Preparation discarded; saved document unchanged. An already started request may still finish.",
    "zh-CN": "准备已丢弃；已保存文档未更改。已经发出的请求仍可能完成。"
  },
  "m362": {
    "ru": "Хранилище подготовлено. Резервная копия: {0}",
    "en": "Storage prepared. Backup: {0}",
    "zh-CN": "存储已准备。备份：{0}"
  },
  "m363": {
    "ru": "Схема сохранённых связей. Переходы и действия доступны в списке ниже.",
    "en": "Saved link diagram. Navigation and actions are available in the list below.",
    "zh-CN": "已保存的关联图。下方列表提供跳转和操作。"
  },
  "m364": {
    "ru": "На схеме {0} из {1} узлов страницы. Направления, типы и переходы перечислены ниже.",
    "en": "Diagram shows {0} of {1} page nodes. Directions, types and navigation are listed below.",
    "zh-CN": "图中显示本页 {1} 个节点中的 {0} 个。方向、类型和跳转列在下方。"
  },
  "m365": {
    "ru": "Читаем сохранённый граф…",
    "en": "Reading saved graph…",
    "zh-CN": "正在读取已保存的图谱…"
  },
  "m366": {
    "ru": "Рёбер на странице: {0}; видимых в выборке: {1}. {2}{3}",
    "en": "Edges on page: {0}; visible in selection: {1}. {2}{3}",
    "zh-CN": "本页边数：{0}；选择中可见：{1}。{2}{3}"
  },
  "m367": {
    "ru": "Полная видимая выборка.",
    "en": "Complete visible selection.",
    "zh-CN": "完整可见结果。"
  },
  "m368": {
    "ru": "Ограниченная выборка.",
    "en": "Limited selection.",
    "zh-CN": "结果受限。"
  },
  "m369": {
    "ru": " Достигнут предел просмотра 5000 кандидатов; уточните фильтры.",
    "en": " Viewing limit of 5,000 candidates reached; refine filters.",
    "zh-CN": " 已达 5,000 个候选项的查看限制；请细化筛选条件。"
  },
  "m370": {
    "ru": "Открыть начало",
    "en": "Open source node",
    "zh-CN": "打开起始节点"
  },
  "m371": {
    "ru": "Открыть цель",
    "en": "Open target node",
    "zh-CN": "打开目标节点"
  },
  "m372": {
    "ru": "Изменить ручную связь",
    "en": "Edit manual link",
    "zh-CN": "编辑手动关联"
  },
  "m373": {
    "ru": "Удалить ручную связь",
    "en": "Delete manual link",
    "zh-CN": "删除手动关联"
  },
  "m374": {
    "ru": "Граф недоступен. Проверьте выбранный документ и уточните фильтры.",
    "en": "Graph unavailable. Check the selected document and refine filters.",
    "zh-CN": "图谱不可用。请检查所选文档并细化筛选条件。"
  },
  "m375": {
    "ru": "Чтение не завершено.",
    "en": "Read incomplete.",
    "zh-CN": "读取未完成。"
  },
  "m376": {
    "ru": "Область: {0}{1}. Чтение не запускает модели или облако.",
    "en": "Scope: {0}{1}. Reading does not use models or cloud.",
    "zh-CN": "范围：{0}{1}。读取不使用模型或云端。"
  },
  "m377": {
    "ru": "Все доступные источники",
    "en": "All available sources",
    "zh-CN": "所有可用来源"
  },
  "m378": {
    "ru": "Не удалось загрузить список документов графа.",
    "en": "Could not load graph document list.",
    "zh-CN": "无法加载图谱文档列表。"
  },
  "m379": {
    "ru": "Подтвердите действие после проверки последствий.",
    "en": "Confirm after reviewing the consequences.",
    "zh-CN": "请检查影响后确认操作。"
  },
  "m380": {
    "ru": "Подтвердите удаление во всех областях.",
    "en": "Confirm deletion in all scopes.",
    "zh-CN": "请确认删除所有范围中的内容。"
  },
  "m381": {
    "ru": "Изменение сохранено. Очистка локального blob ожидает повтора.",
    "en": "Change saved. Local blob cleanup awaits retry.",
    "zh-CN": "更改已保存。本地数据块清理等待重试。"
  },
  "m382": {
    "ru": "Изменение сохранено.",
    "en": "Change saved.",
    "zh-CN": "更改已保存。"
  },
  "m383": {
    "ru": "Данные изменились. Закройте окно и проверьте новый предпросмотр.",
    "en": "Data changed. Close this dialog and review a new preview.",
    "zh-CN": "数据已更改。请关闭窗口并检查新预览。"
  },
  "m384": {
    "ru": "Удаление не подтверждено или не выполнено. Закройте окно и повторите проверку.",
    "en": "Deletion unconfirmed or incomplete. Close this dialog and review again.",
    "zh-CN": "删除未确认或未完成。请关闭窗口并重新检查。"
  },
  "m385": {
    "ru": "Удалить источник полностью",
    "en": "Delete source entirely",
    "zh-CN": "彻底删除来源"
  },
  "m386": {
    "ru": "Убрать источник из области",
    "en": "Remove source from scope",
    "zh-CN": "从范围移除来源"
  },
  "m387": {
    "ru": "Проверяем последствия…",
    "en": "Checking consequences…",
    "zh-CN": "正在检查影响…"
  },
  "m388": {
    "ru": "{0}\n{1}\nОбластей будет снято: {2}; останется: {3}.\nСвязей будет удалено: {4}, из других областей: {5}; сохранится: {6}.\n{7}\n{8}",
    "en": "{0}\n{1}\nScopes removed: {2}; remaining: {3}.\nLinks deleted: {4}, from other scopes: {5}; retained: {6}.\n{7}\n{8}",
    "zh-CN": "{0}\n{1}\n将移除的范围：{2}；保留：{3}。\n将删除的关联：{4}，其中其他范围：{5}；保留：{6}。\n{7}\n{8}"
  },
  "m389": {
    "ru": "Документ и его индекс будут удалены. Notebook-факты сохранятся.",
    "en": "Document and index will be deleted. Notebook facts will remain.",
    "zh-CN": "文档及其索引将删除。Notebook 事实将保留。"
  },
  "m390": {
    "ru": "Документ и индекс сохранятся в других областях.",
    "en": "Document and index will remain in other scopes.",
    "zh-CN": "文档和索引将在其他范围中保留。"
  },
  "m391": {
    "ru": "Sections: {0}; medium: {1}; micro: {2}; рёбер: {3}.",
    "en": "Sections: {0}; medium: {1}; micro: {2}; edges: {3}.",
    "zh-CN": "章节：{0}；中分块：{1}；微分块：{2}；边：{3}。"
  },
  "m392": {
    "ru": "{0} — будет удалена",
    "en": "{0} — will be deleted",
    "zh-CN": "{0} — 将删除"
  },
  "m393": {
    "ru": "Сначала подготовьте хранилище через редактор знаний.",
    "en": "Prepare storage through the knowledge editor first.",
    "zh-CN": "请先通过知识编辑器准备存储。"
  },
  "m394": {
    "ru": "Предпросмотр недоступен. Проверьте область и повторите действие.",
    "en": "Preview unavailable. Check scope and try again.",
    "zh-CN": "预览不可用。请检查范围并重试。"
  },
  "m395": {
    "ru": "Готовим embedding запроса из локального кэша…",
    "en": "Preparing query embedding from local cache…",
    "zh-CN": "正在使用本地缓存准备查询向量…"
  },
  "m396": {
    "ru": "Ищем по сохранённому текстовому индексу…",
    "en": "Searching saved text index…",
    "zh-CN": "正在搜索已保存的文本索引…"
  },
  "m397": {
    "ru": "Результатов: {0}. {1}",
    "en": "Results: {0}. {1}",
    "zh-CN": "结果：{0}。{1}"
  },
  "m398": {
    "ru": "Модель: {0}; query dimension: {1}; предел vector scan: {2}.",
    "en": "Model: {0}; query dimension: {1}; vector scan limit: {2}.",
    "zh-CN": "模型：{0}；查询维度：{1}；向量扫描上限：{2}。"
  },
  "m399": {
    "ru": "из конфигурации",
    "en": "from configuration",
    "zh-CN": "来自配置"
  },
  "m400": {
    "ru": "Lexical: embeddings и reranker не запускались.",
    "en": "Lexical: embeddings and reranker were not run.",
    "zh-CN": "词法搜索：未运行嵌入模型或重排器。"
  },
  "m401": {
    "ru": "Ревизия текста: {0}; индекс: {1}. Фрагмент: {2}; {3}{4}.",
    "en": "Text revision: {0}; index: {1}. Fragment: {2}; {3}{4}.",
    "zh-CN": "正文修订：{0}；索引：{1}。片段：{2}；{3}{4}。"
  },
  "m402": {
    "ru": " · текст усечён до 20000 символов",
    "en": " · text truncated to 20,000 characters",
    "zh-CN": " · 正文已截断至 20,000 个字符"
  },
  "m403": {
    "ru": "Score: {0} ({1}); FTS: {2}; cosine: {3}; rerank: не запускался.",
    "en": "Score: {0} ({1}); FTS: {2}; cosine: {3}; rerank: not run.",
    "zh-CN": "评分：{0}（{1}）；FTS：{2}；余弦：{3}；重排：未运行。"
  },
  "m404": {
    "ru": "не предоставлен",
    "en": "not provided",
    "zh-CN": "未提供"
  },
  "m405": {
    "ru": "Provenance документа: {0}",
    "en": "Document provenance: {0}",
    "zh-CN": "文档出处：{0}"
  },
  "m406": {
    "ru": "Открыть источник",
    "en": "Open source",
    "zh-CN": "打开来源"
  },
  "m407": {
    "ru": "Открыть возвращённый фрагмент",
    "en": "Open returned fragment",
    "zh-CN": "打开返回的片段"
  },
  "m408": {
    "ru": "Источники изменились во время подготовки запроса. Выполните поиск снова.",
    "en": "Sources changed while preparing the query. Run search again.",
    "zh-CN": "准备查询时来源已更改。请重新搜索。"
  },
  "m409": {
    "ru": "Dense недоступен: проверьте локальную модель через CLI или выберите текстовый поиск.",
    "en": "Dense unavailable: check the local model in the CLI or select text search.",
    "zh-CN": "稠密搜索不可用：请通过 CLI 检查本地模型或选择文本搜索。"
  },
  "m410": {
    "ru": "Поиск не выполнен. Проверьте хранилище и повторите запрос.",
    "en": "Search failed. Check storage and retry.",
    "zh-CN": "搜索失败。请检查存储并重试。"
  },
  "m411": {
    "ru": "Поиск не завершён.",
    "en": "Search incomplete.",
    "zh-CN": "搜索未完成。"
  },
  "m412": {
    "ru": "Введите запрос. Это предпросмотр retrieval, а не подтверждение использования памяти агентом.",
    "en": "Enter a query. This previews retrieval and does not confirm agent memory usage.",
    "zh-CN": "请输入查询。这是检索预览，不能证明代理使用了记忆。"
  },
  "m413": {
    "ru": "Проверяем наличие локальной модели…",
    "en": "Checking local model availability…",
    "zh-CN": "正在检查本地模型…"
  },
  "m414": {
    "ru": "{0} · кэш: {1} · {2}. {3}",
    "en": "{0} · cache: {1} · {2}. {3}",
    "zh-CN": "{0} · 缓存：{1} · {2}。{3}"
  },
  "m415": {
    "ru": "загружена",
    "en": "loaded",
    "zh-CN": "已加载"
  },
  "m416": {
    "ru": "не загружена",
    "en": "not loaded",
    "zh-CN": "未加载"
  },
  "m417": {
    "ru": "Dense загрузит только локальные файлы по явному запросу.",
    "en": "Dense loads local files only, on explicit request.",
    "zh-CN": "稠密搜索仅在明确请求时加载本地文件。"
  },
  "m418": {
    "ru": "Dense недоступен; подготовьте модель через CLI.",
    "en": "Dense unavailable; prepare the model through the CLI.",
    "zh-CN": "稠密搜索不可用；请通过 CLI 准备模型。"
  },
  "m419": {
    "ru": "Состояние модели недоступно. Текстовый поиск остаётся отдельным режимом.",
    "en": "Model status unavailable. Text search remains a separate mode.",
    "zh-CN": "模型状态不可用。文本搜索仍可单独使用。"
  },
  "m420": {
    "ru": "Данные изменились. Черновик сохранён; выполните предпросмотр снова.",
    "en": "Data changed. Draft retained; run preview again.",
    "zh-CN": "数据已更改。草稿已保留；请重新预览。"
  },
  "m421": {
    "ru": "Сначала подготовьте устойчивые связи кнопкой «Подготовить связи». Перед миграцией сохранится полный ZIP-снимок.",
    "en": "Use Prepare links first. A full ZIP snapshot is saved before migration.",
    "zh-CN": "请先点击“准备关联”。迁移前将保存完整 ZIP 快照。"
  },
  "m422": {
    "ru": "Проверьте факт, источник, раздел и диапазон строк.",
    "en": "Check the fact, source, section and line range.",
    "zh-CN": "请检查事实、来源、章节和行范围。"
  },
  "m423": {
    "ru": "Ожидает восстановления совместная правка. Проверьте локальный журнал через CLI перед продолжением.",
    "en": "A combined edit awaits recovery. Check the local journal in the CLI before continuing.",
    "zh-CN": "联合编辑等待恢复。继续前请通过 CLI 检查本地日志。"
  },
  "m424": {
    "ru": "Не удалось изменить связь. Обновите данные и повторите действие.",
    "en": "Could not change link. Refresh data and try again.",
    "zh-CN": "无法更改关联。请刷新数据并重试。"
  },
  "m425": {
    "ru": "{0} источников · показано до 100. Уточните поиск, если нужного нет.",
    "en": "{0} sources · showing up to 100. Refine search if yours is missing.",
    "zh-CN": "{0} 个来源 · 最多显示 100 个。若未找到所需来源，请细化搜索。"
  },
  "m426": {
    "ru": "Новая связь",
    "en": "New link",
    "zh-CN": "新建关联"
  },
  "m427": {
    "ru": "Проверить удаление",
    "en": "Review deletion",
    "zh-CN": "检查删除操作"
  },
  "m428": {
    "ru": "Предпросмотр связи",
    "en": "Link preview",
    "zh-CN": "关联预览"
  },
  "m429": {
    "ru": "Область: {0}{1}. Действие касается одной связи.",
    "en": "Scope: {0}{1}. This action affects one link.",
    "zh-CN": "范围：{0}{1}。此操作仅影响一条关联。"
  },
  "m430": {
    "ru": " · связь {0}",
    "en": " · link {0}",
    "zh-CN": " · 关联 {0}"
  },
  "m431": {
    "ru": "{0}\nФакт: {1}\nИсточник: {2}{3}{4}",
    "en": "{0}\nFact: {1}\nSource: {2}{3}{4}",
    "zh-CN": "{0}\n事实：{1}\n来源：{2}{3}{4}"
  },
  "m432": {
    "ru": "Добавить связь",
    "en": "Add link",
    "zh-CN": "添加关联"
  },
  "m433": {
    "ru": "Удалить эту связь; факт и источник сохранятся",
    "en": "Delete this link; fact and source remain",
    "zh-CN": "删除此关联；保留事实和来源"
  },
  "m434": {
    "ru": "\nОтношение: {0}",
    "en": "\nRelation: {0}",
    "zh-CN": "\n关系：{0}"
  },
  "m435": {
    "ru": "\nСтроки {0}–{1}\n{2}",
    "en": "\nLines {0}–{1}\n{2}",
    "zh-CN": "\n第 {0}–{1} 行\n{2}"
  },
  "m436": {
    "ru": "Удалить эту связь",
    "en": "Delete this link",
    "zh-CN": "删除此关联"
  },
  "m437": {
    "ru": "Сохранить эту связь",
    "en": "Save this link",
    "zh-CN": "保存此关联"
  },
  "m438": {
    "ru": "Связь сохранена.",
    "en": "Link saved.",
    "zh-CN": "关联已保存。"
  },
  "m439": {
    "ru": "Связи подготовлены. Присвоено ID: {0}; неоднозначных связей: {1}. Резервный снимок: {2}",
    "en": "Links prepared. IDs assigned: {0}; ambiguous links: {1}. Backup: {2}",
    "zh-CN": "关联已准备。已分配 ID：{0}；不明确关联：{1}。备份：{2}"
  },
  "m440": {
    "ru": "Миграция не завершена. Проверьте локальное хранилище; исходные данные и резервный снимок сохранены.",
    "en": "Migration incomplete. Check local storage; original data and backup retained.",
    "zh-CN": "迁移未完成。请检查本地存储；原始数据和备份已保留。"
  },
  "m441": {
    "ru": "Состояние изменилось в другом клиенте. Обновите состояние и проверьте изменения снова.",
    "en": "State changed in another client. Refresh and review changes again.",
    "zh-CN": "其他客户端已更改状态。请刷新并重新检查更改。"
  },
  "m442": {
    "ru": "Все локальные области RAG. Notebook и проекты сохраняются. Импорт заменяет затронутые документы целиком, включая чанки и области; режим полной замены и сброс удаляют отсутствующие источники и их ссылки Notebook. Перед изменением создаётся проверенный полный ZIP. Файлы неиспользуемых blobs остаются для отдельной очистки. Экспорт сохраняет только RAG.",
    "en": "All local RAG scopes. Notebook and projects remain. Import replaces affected documents in full, including chunks and scopes; full replacement and reset remove absent sources and their Notebook links. A verified full ZIP is created first. Unused blobs remain for separate cleanup. Export saves RAG only.",
    "zh-CN": "涉及所有本地 RAG 范围。Notebook 和项目保留。导入会完整替换受影响文档，包括分块和范围；完全替换与重置会移除未包含的来源及其 Notebook 关联。更改前创建并验证完整 ZIP。未使用数据块留待单独清理。导出仅保存 RAG。"
  },
  "m443": {
    "ru": "Один Notebook. Даты, keep, TTL, история и источники сохраняются. Перед записью создаётся проверенный полный ZIP. Синхронизацию файлов клиентов выполните отдельно в разделе «Инструкции».",
    "en": "One Notebook. Dates, keep, TTL, history and sources remain. A verified full ZIP is created before writing. Sync client files separately under Instructions.",
    "zh-CN": "仅一个 Notebook。日期、keep、TTL、历史和来源保留。写入前创建并验证完整 ZIP。请在“指令”中单独同步客户端文件。"
  },
  "m444": {
    "ru": "Поиск, модели и доступ к источникам. Режим хранения, облачное подключение, расписание снимков, порт и автозапуск сохраняются. Модели в процессах и существующие векторы не меняются. Есть резервная копия для восстановления.",
    "en": "Search, models and source access. Storage mode, cloud connection, snapshot schedule, port and autostart remain. Loaded models and existing vectors are unchanged. A recovery backup is available.",
    "zh-CN": "涉及搜索、模型和来源访问。存储模式、云端连接、快照计划、端口和自动启动保留。已加载模型和现有向量不变。提供恢复备份。"
  },
  "m445": {
    "ru": "Сначала подготовьте связи в разделе «Знания → Подготовить связи». После этого станут доступны экспорт, импорт и сброс RAG. Выбранный файл можно проверить заранее.",
    "en": "First prepare links under Knowledge → Prepare links. RAG export, import and reset will then be available. You can validate the selected file in advance.",
    "zh-CN": "请先在“知识 → 准备关联”中准备关联，之后即可导出、导入和重置 RAG。可提前验证所选文件。"
  },
  "m446": {
    "ru": "Создать и скачать экспорт",
    "en": "Create and download export",
    "zh-CN": "创建并下载导出文件"
  },
  "m447": {
    "ru": "Проверить изменения",
    "en": "Review changes",
    "zh-CN": "检查更改"
  },
  "m448": {
    "ru": "Повреждённые входные снимки исключены из списка.",
    "en": "Corrupt input snapshots excluded from the list.",
    "zh-CN": "已从列表排除损坏的输入快照。"
  },
  "m449": {
    "ru": "Notebook недоступен; операции с настройками остаются доступны.",
    "en": "Notebook unavailable; settings operations remain available.",
    "zh-CN": "Notebook 不可用；设置操作仍可使用。"
  },
  "m450": {
    "ru": "Есть повреждённые резервные копии настроек. Они исключены из списка восстановления.",
    "en": "Some settings backups are corrupt and excluded from recovery.",
    "zh-CN": "部分设置备份损坏，已从恢复列表排除。"
  },
  "m451": {
    "ru": "Экспорт сохранён: {0}. ID: {1}.",
    "en": "Export saved: {0}. ID: {1}.",
    "zh-CN": "导出已保存：{0}。ID：{1}。"
  },
  "m452": {
    "ru": "Все локальные области RAG",
    "en": "All local RAG scopes",
    "zh-CN": "所有本地 RAG 范围"
  },
  "m453": {
    "ru": "Настройки",
    "en": "Settings",
    "zh-CN": "设置"
  },
  "m454": {
    "ru": "Есть изменения",
    "en": "Changes present",
    "zh-CN": "有更改"
  },
  "m455": {
    "ru": "Документы и Notes",
    "en": "Documents and Notes",
    "zh-CN": "文档和笔记"
  },
  "m456": {
    "ru": "Разделы",
    "en": "Sections",
    "zh-CN": "章节"
  },
  "m457": {
    "ru": "Средние чанки",
    "en": "Medium chunks",
    "zh-CN": "中分块"
  },
  "m458": {
    "ru": "Микрочанки",
    "en": "Micro chunks",
    "zh-CN": "微分块"
  },
  "m459": {
    "ru": "Привязки областей",
    "en": "Scope assignments",
    "zh-CN": "范围分配"
  },
  "m460": {
    "ru": "Ссылки Notebook",
    "en": "Notebook links",
    "zh-CN": "Notebook 关联"
  },
  "m461": {
    "ru": "Рёбра графа",
    "en": "Graph edges",
    "zh-CN": "图谱边"
  },
  "m462": {
    "ru": "Метки удалённых источников",
    "en": "Deleted source markers",
    "zh-CN": "已删除来源标记"
  },
  "m463": {
    "ru": "Заменяемые и удаляемые источники",
    "en": "Sources replaced or deleted",
    "zh-CN": "将替换或删除的来源"
  },
  "m464": {
    "ru": "Входящие источники",
    "en": "Incoming sources",
    "zh-CN": "传入来源"
  },
  "m465": {
    "ru": "Удаляемые или изменяемые ссылки Notebook",
    "en": "Notebook links deleted or changed",
    "zh-CN": "将删除或更改的 Notebook 关联"
  },
  "m466": {
    "ru": "Ссылки, требующие проверки",
    "en": "Links needing review",
    "zh-CN": "需要检查的关联"
  },
  "m467": {
    "ru": "Очищаемые несовместимые векторы: {0}.{1}",
    "en": "Incompatible vectors cleared: {0}.{1}",
    "zh-CN": "将清除的不兼容向量：{0}。{1}"
  },
  "m468": {
    "ru": " После импорта выполните переиндексацию в разделе «Модели».",
    "en": " Reindex under Models after import.",
    "zh-CN": " 导入后请在“模型”中重建索引。"
  },
  "m469": {
    "ru": "Изменений нет.",
    "en": "No changes.",
    "zh-CN": "没有更改。"
  },
  "m470": {
    "ru": "Сейчас:\n{0}\n\nПосле:\n{1}",
    "en": "Now:\n{0}\n\nAfter:\n{1}",
    "zh-CN": "当前：\n{0}\n\n更改后：\n{1}"
  },
  "m471": {
    "ru": "Проверено: {0}",
    "en": "Checked: {0}",
    "zh-CN": "检查时间：{0}"
  },
  "m472": {
    "ru": "{0}. Резервная копия: {1}.{2}{3}",
    "en": "{0}. Backup: {1}.{2}{3}",
    "zh-CN": "{0}。备份：{1}。{2}{3}"
  },
  "m473": {
    "ru": " ID операции: {0}. Notebook сохранён; неиспользуемые blobs оставлены.",
    "en": " Operation ID: {0}. Notebook saved; unused blobs retained.",
    "zh-CN": " 操作 ID：{0}。Notebook 已保存；未使用数据块已保留。"
  },
  "m474": {
    "ru": " Модели в процессах и файлы клиентов не синхронизированы.",
    "en": " Loaded models and client files are not synced.",
    "zh-CN": " 已加载模型和客户端文件未同步。"
  },
  "m475": {
    "ru": " Требуется переиндексация знаний.",
    "en": " Knowledge reindexing required.",
    "zh-CN": " 需要重建知识索引。"
  },
  "m476": {
    "ru": "Изменения сохранены; обновить основной экран не удалось.",
    "en": "Changes saved; could not refresh the main screen.",
    "zh-CN": "更改已保存；无法刷新主屏幕。"
  },
  "m477": {
    "ru": "Если ответ потерян, обновите состояние и проверьте последние завершённые операции перед повтором.",
    "en": "If the response is lost, refresh status and check recent completed operations before retrying.",
    "zh-CN": "若响应丢失，请刷新状态并检查最近完成的操作后再重试。"
  },
  "m478": {
    "ru": "Файл превышает 32 МиБ.",
    "en": "File exceeds 32 MiB.",
    "zh-CN": "文件超过 32 MiB。"
  },
  "m479": {
    "ru": "Проверяется файл снимка…",
    "en": "Validating snapshot file…",
    "zh-CN": "正在验证快照文件…"
  },
  "m480": {
    "ru": "Не удалось прочитать файл.",
    "en": "Could not read file.",
    "zh-CN": "无法读取文件。"
  },
  "m481": {
    "ru": "Файл проверен: {0}. Теперь проверьте изменения.",
    "en": "File validated: {0}. Now review changes.",
    "zh-CN": "文件已验证：{0}。现在请检查更改。"
  },
  "m482": {
    "ru": "Скачивание",
    "en": "Download",
    "zh-CN": "下载"
  },
  "m483": {
    "ru": "Загрузка в память",
    "en": "Load into memory",
    "zh-CN": "加载到内存"
  },
  "m484": {
    "ru": "Выгрузка из памяти",
    "en": "Unload from memory",
    "zh-CN": "从内存卸载"
  },
  "m485": {
    "ru": "Смена устройства",
    "en": "Change device",
    "zh-CN": "切换设备"
  },
  "m486": {
    "ru": "Переиндексация",
    "en": "Reindex",
    "zh-CN": "重建索引"
  },
  "m487": {
    "ru": "В очереди",
    "en": "Queued",
    "zh-CN": "排队中"
  },
  "m488": {
    "ru": "Выполняется",
    "en": "Running",
    "zh-CN": "运行中"
  },
  "m489": {
    "ru": "Завершено",
    "en": "Completed",
    "zh-CN": "已完成"
  },
  "m490": {
    "ru": "Результат не подтверждён",
    "en": "Result unconfirmed",
    "zh-CN": "结果未确认"
  },
  "m491": {
    "ru": "Ожидается подтверждение клиента",
    "en": "Awaiting client confirmation",
    "zh-CN": "等待客户端确认"
  },
  "m492": {
    "ru": "Зарегистрированный процесс клиента не найден. Состояние загруженных моделей неизвестно; скачивание и переиндексация доступны отдельно.",
    "en": "No registered client process found. Loaded model status unknown; download and reindexing are separately available.",
    "zh-CN": "未找到已注册的客户端进程。已加载模型状态未知；仍可单独下载和重建索引。"
  },
  "m493": {
    "ru": "Состояние процесса устарело. Дождитесь свежего подтверждения.",
    "en": "Process status is stale. Wait for fresh confirmation.",
    "zh-CN": "进程状态已过期。请等待最新确认。"
  },
  "m494": {
    "ru": "Для команд требуется обновление плагина в этом клиенте.",
    "en": "Update the plugin in this client to use commands.",
    "zh-CN": "使用命令前请更新此客户端中的插件。"
  },
  "m495": {
    "ru": "Состояние на {0}.",
    "en": "Status as of {0}.",
    "zh-CN": "状态时间：{0}。"
  },
  "m496": {
    "ru": "RAM процесса",
    "en": "Process RAM",
    "zh-CN": "进程 RAM"
  },
  "m497": {
    "ru": "{0} МБ",
    "en": "{0} MB",
    "zh-CN": "{0} MB"
  },
  "m498": {
    "ru": "Не загружена в этом процессе",
    "en": "Not loaded in this process",
    "zh-CN": "此进程中未加载"
  },
  "m499": {
    "ru": "Размерность",
    "en": "Dimensions",
    "zh-CN": "维度"
  },
  "m500": {
    "ru": "По модели",
    "en": "Model default",
    "zh-CN": "模型默认值"
  },
  "m501": {
    "ru": "Выключен",
    "en": "Disabled",
    "zh-CN": "已停用"
  },
  "m502": {
    "ru": "Устройство по умолчанию",
    "en": "Default device",
    "zh-CN": "默认设备"
  },
  "m503": {
    "ru": "Выгрузка при простое",
    "en": "Idle unload",
    "zh-CN": "空闲卸载"
  },
  "m504": {
    "ru": "{0} мин",
    "en": "{0} min",
    "zh-CN": "{0} 分钟"
  },
  "m505": {
    "ru": "Отключена",
    "en": "Disabled",
    "zh-CN": "已停用"
  },
  "m506": {
    "ru": " · устарело",
    "en": " · stale",
    "zh-CN": " · 已过期"
  },
  "m507": {
    "ru": "{0} · {1} МБ",
    "en": "{0} · {1} MB",
    "zh-CN": "{0} · {1} MB"
  },
  "m508": {
    "ru": "Файлы на месте",
    "en": "Files present",
    "zh-CN": "文件已就绪"
  },
  "m509": {
    "ru": "Частичный кэш",
    "en": "Partial cache",
    "zh-CN": "缓存不完整"
  },
  "m510": {
    "ru": "Не скачана",
    "en": "Not downloaded",
    "zh-CN": "未下载"
  },
  "m511": {
    "ru": "Удалить кэш",
    "en": "Delete cache",
    "zh-CN": "删除缓存"
  },
  "m512": {
    "ru": "Удалить кэш {0}",
    "en": "Delete cache for {0}",
    "zh-CN": "删除 {0} 的缓存"
  },
  "m513": {
    "ru": "{0} / {1} чанков",
    "en": "{0} / {1} chunks",
    "zh-CN": "{0} / {1} 个分块"
  },
  "m514": {
    "ru": "{0}: модель проверена, кэш сохранён.",
    "en": "{0}: model validated, cache saved.",
    "zh-CN": "{0}：模型已验证，缓存已保存。"
  },
  "m515": {
    "ru": "Перестроено чанков: {0}; документов: {1}.",
    "en": "Chunks rebuilt: {0}; documents: {1}.",
    "zh-CN": "已重建分块：{0}；文档：{1}。"
  },
  "m516": {
    "ru": "Клиент подтвердил выполнение команды.",
    "en": "Client confirmed command completion.",
    "zh-CN": "客户端已确认命令完成。"
  },
  "m517": {
    "ru": "Операция продолжится при закрытии окна. Закрытие не отменяет команду.",
    "en": "The operation continues if you close this dialog. Closing does not cancel the command.",
    "zh-CN": "关闭窗口后操作仍会继续。关闭不会取消命令。"
  },
  "m518": {
    "ru": "Удалить файлы этой модели с диска? Для повторного использования потребуется скачивание.",
    "en": "Delete this model's files from disk? Using it again will require downloading.",
    "zh-CN": "从磁盘删除此模型文件？再次使用需要重新下载。"
  },
  "m519": {
    "ru": "Перестроить векторы во всех локальных областях знаний? Сначала подготовятся новые векторы, затем индекс сохранится одной транзакцией.",
    "en": "Rebuild vectors across all local knowledge scopes? New vectors are prepared first, then the index is saved in one transaction.",
    "zh-CN": "重建所有本地知识范围的向量？先准备新向量，再通过单次事务保存索引。"
  },
  "m520": {
    "ru": "Модель",
    "en": "Model",
    "zh-CN": "模型"
  },
  "m521": {
    "ru": "Размер",
    "en": "Size",
    "zh-CN": "大小"
  },
  "m522": {
    "ru": "Документы",
    "en": "Documents",
    "zh-CN": "文档"
  },
  "m523": {
    "ru": "Чанки",
    "en": "Chunks",
    "zh-CN": "分块"
  },
  "m524": {
    "ru": "Скачать модель из Hugging Face и проверить её загрузку на CPU?",
    "en": "Download the model from Hugging Face and validate loading on CPU?",
    "zh-CN": "从 Hugging Face 下载模型并验证 CPU 加载？"
  },
  "m525": {
    "ru": "Выгрузить embedding и reranker из выбранного процесса?",
    "en": "Unload embedding and reranker from the selected process?",
    "zh-CN": "从所选进程卸载嵌入模型和重排器？"
  },
  "m526": {
    "ru": "Загрузить выбранные модели из локального кэша? Выбор устройства сохраняется для следующих загрузок.",
    "en": "Load selected models from local cache? The device choice is saved for future loads.",
    "zh-CN": "从本地缓存加载所选模型？设备选择将保存并用于后续加载。"
  },
  "m527": {
    "ru": "Сохранить устройство и выгрузить прежние экземпляры в выбранном процессе? Следующая обработка загрузит модели на выбранное устройство.",
    "en": "Save device and unload old instances in the selected process? The next operation will load models on the selected device.",
    "zh-CN": "保存设备并卸载所选进程中的旧实例？下次处理将在所选设备加载模型。"
  },
  "m528": {
    "ru": "Процесс",
    "en": "Process",
    "zh-CN": "进程"
  },
  "m529": {
    "ru": "Устройство",
    "en": "Device",
    "zh-CN": "设备"
  },
  "m530": {
    "ru": "Кэш удалён: {0}.",
    "en": "Cache deleted: {0}.",
    "zh-CN": "缓存已删除：{0}。"
  },
  "m531": {
    "ru": "Другой проект",
    "en": "Other project",
    "zh-CN": "其他项目"
  },
  "m532": {
    "ru": "Проектные инструкции не входят в глобальный файл этого клиента",
    "en": "Project instructions are not included in this client's global file",
    "zh-CN": "项目指令不包含在此客户端的全局文件中"
  },
  "m533": {
    "ru": "Настоящие построители OpenCode V1 и V2: глобальная память и выбранный проект. Инструкции передаются полностью, без лимита количества.",
    "en": "Actual OpenCode V1 and V2 builders: global memory and selected project. Instructions are delivered in full without a count limit.",
    "zh-CN": "实际使用 OpenCode V1 和 V2 构建器：全局记忆和所选项目。指令完整传递，无数量限制。"
  },
  "m534": {
    "ru": "Предпросмотр формата адаптера из глобальных инструкций. Содержимое файлов клиента и контекст активной сессии здесь не проверяются.",
    "en": "Adapter format preview from global instructions. Client file contents and active session context are not checked here.",
    "zh-CN": "基于全局指令的适配器格式预览。此处不检查客户端文件内容或活动会话上下文。"
  },
  "m535": {
    "ru": "Снимок памяти: {0}. Передача в активную сессию и использование агентом: нет данных.",
    "en": "Memory snapshot: {0}. Delivery to an active session and agent usage: no data.",
    "zh-CN": "记忆快照：{0}。向活动会话传递及代理使用情况：无数据。"
  },
  "m536": {
    "ru": "Список неполный: недоступных хранилищ — {0}. {1}",
    "en": "Incomplete list: {0} unavailable stores. {1}",
    "zh-CN": "列表不完整：{0} 个存储不可用。{1}"
  },
  "m537": {
    "ru": "Включены как инструкции: {0}. Исключены из инструкций: {1}.",
    "en": "Included as instructions: {0}. Excluded: {1}.",
    "zh-CN": "作为指令包含：{0}。已排除：{1}。"
  },
  "m538": {
    "ru": "Включены",
    "en": "Included",
    "zh-CN": "已包含"
  },
  "m539": {
    "ru": "Исключены из инструкций",
    "en": "Excluded from instructions",
    "zh-CN": "已从指令排除"
  },
  "m540": {
    "ru": "Инструкций в этой группе нет.",
    "en": "No instructions in this group.",
    "zh-CN": "此组中没有指令。"
  },
  "m541": {
    "ru": "Включена",
    "en": "Enabled",
    "zh-CN": "已启用"
  },
  "m542": {
    "ru": "OpenCode передаёт эту запись как факт с отметкой истечения срока, без роли действующей инструкции.",
    "en": "OpenCode delivers this record as an expired fact, without an active instruction role.",
    "zh-CN": "OpenCode 将此记录作为已过期事实传递，不作为活动指令。"
  },
  "m543": {
    "ru": "Legacy-теги персоны учитываются движком.",
    "en": "The engine recognizes legacy persona tags.",
    "zh-CN": "引擎会识别旧 persona 标签。"
  },
  "m544": {
    "ru": "Текст инструкции",
    "en": "Instruction text",
    "zh-CN": "指令正文"
  },
  "m545": {
    "ru": "Открыть запись",
    "en": "Open record",
    "zh-CN": "打开记录"
  },
  "m546": {
    "ru": "Формат клиента (шаблон): {0}",
    "en": "Client format (template): {0}",
    "zh-CN": "客户端格式（模板）：{0}"
  },
  "m547": {
    "ru": "Блок пуст.",
    "en": "Block is empty.",
    "zh-CN": "区块为空。"
  },
  "m548": {
    "ru": "Исходный блок: {0}",
    "en": "Raw block: {0}",
    "zh-CN": "原始区块：{0}"
  },
  "m549": {
    "ru": "Привязать каталог",
    "en": "Link directory",
    "zh-CN": "关联目录"
  },
  "m550": {
    "ru": "Отвязать каталог",
    "en": "Unlink directory",
    "zh-CN": "取消关联目录"
  },
  "m551": {
    "ru": "Перенести память",
    "en": "Move memory",
    "zh-CN": "移动记忆"
  },
  "m552": {
    "ru": "Перенести legacy-память",
    "en": "Move legacy memory",
    "zh-CN": "移动旧记忆"
  },
  "m553": {
    "ru": "Данные изменились или есть конфликт записей. Поля сохранены; проверьте предпросмотр заново.",
    "en": "Data changed or records conflict. Fields retained; review the preview again.",
    "zh-CN": "数据已更改或记录冲突。字段已保留；请重新检查预览。"
  },
  "m554": {
    "ru": "Проверьте абсолютный путь существующего Git-каталога, источник и целевой проект.",
    "en": "Check the absolute path of an existing Git directory, source and destination project.",
    "zh-CN": "请检查现有 Git 目录的绝对路径、来源和目标项目。"
  },
  "m555": {
    "ru": "Проект или ассоциация больше не доступны. Обновите список.",
    "en": "Project or association no longer available. Refresh the list.",
    "zh-CN": "项目或关联已不可用。请刷新列表。"
  },
  "m556": {
    "ru": "Сначала восстановите память прежнего облачного режима через CLI.",
    "en": "Recover legacy cloud memory through the CLI first.",
    "zh-CN": "请先通过 CLI 恢复旧云端记忆。"
  },
  "m557": {
    "ru": "Публикация требует восстановления. Проверьте локальный журнал перед продолжением.",
    "en": "Publication requires recovery. Check the local journal before continuing.",
    "zh-CN": "发布需要恢复。继续前请检查本地日志。"
  },
  "m558": {
    "ru": "Операция не завершена. Проверьте доступ к локальному хранилищу и резервному снимку.",
    "en": "Operation incomplete. Check access to local storage and backup.",
    "zh-CN": "操作未完成。请检查本地存储和备份访问权限。"
  },
  "m559": {
    "ru": "Идентичность",
    "en": "Identity",
    "zh-CN": "标识"
  },
  "m560": {
    "ru": "Записей",
    "en": "Records",
    "zh-CN": "记录"
  },
  "m561": {
    "ru": "Документов",
    "en": "Documents",
    "zh-CN": "文档"
  },
  "m562": {
    "ru": "Нет данных",
    "en": "No data",
    "zh-CN": "无数据"
  },
  "m563": {
    "ru": "Зарегистрированных ассоциаций нет.",
    "en": "No registered associations.",
    "zh-CN": "没有已注册的关联。"
  },
  "m564": {
    "ru": "Отвязка удаляет только ассоциацию пути. Память и Git-автоопределение сохраняются.",
    "en": "Unlinking removes only the path association. Memory and Git autodetection remain.",
    "zh-CN": "取消关联仅移除路径关联。记忆和 Git 自动识别保留。"
  },
  "m565": {
    "ru": "Укажите существующий Git-каталог. Привязка обнаружит память прежнего пути; перенос потребует проверки.",
    "en": "Enter an existing Git directory. Linking detects memory from the old path; moving requires review.",
    "zh-CN": "请输入现有 Git 目录。关联会查找旧路径记忆；移动需要检查。"
  },
  "m566": {
    "ru": "Память объединится с выбранным проектом. Конфликтующие записи останутся на месте до их исправления. Git remote репозитория не меняется.",
    "en": "Memory will merge into the selected project. Conflicting records remain until fixed. Repository Git remote is unchanged.",
    "zh-CN": "记忆将合并到所选项目。冲突记录保留至修复。仓库 Git remote 不变。"
  },
  "m567": {
    "ru": "Перед переносом памяти сохранится проверенный полный локальный ZIP.",
    "en": "A verified full local ZIP is saved before moving memory.",
    "zh-CN": "移动记忆前将保存并验证完整本地 ZIP。"
  },
  "m568": {
    "ru": "Изменения регистрации сохранятся одной транзакцией.",
    "en": "Registration changes saved in one transaction.",
    "zh-CN": "注册更改通过单次事务保存。"
  },
  "m569": {
    "ru": "{0}\n{1} → {2}\nЗаписей в источнике: {3}; в цели: {4}; добавится: {5}; совпадений: {6}; новых ID: {7}.\nДокументов: {8}; связей: {9}.\n{10}",
    "en": "{0}\n{1} → {2}\nSource records: {3}; destination: {4}; added: {5}; duplicates: {6}; new IDs: {7}.\nDocuments: {8}; links: {9}.\n{10}",
    "zh-CN": "{0}\n{1} → {2}\n来源记录：{3}；目标：{4}；新增：{5}；重复：{6}；新 ID：{7}。\n文档：{8}；关联：{9}。\n{10}"
  },
  "m570": {
    "ru": "Удаление ассоциации",
    "en": "Remove association",
    "zh-CN": "移除关联"
  },
  "m571": {
    "ru": "Удаляется только выбранная ассоциация пути. Записи, документы, другие aliases и Git-автоопределение сохраняются.",
    "en": "Only the selected path association is removed. Records, documents, other aliases and Git autodetection remain.",
    "zh-CN": "仅移除所选路径关联。记录、文档、其他别名和 Git 自动识别保留。"
  },
  "m572": {
    "ru": "Записи объединяются с сохранением метаданных; совпавшие ID переназначаются вместе со связями.",
    "en": "Records merge with metadata preserved; colliding IDs are reassigned with their links.",
    "zh-CN": "记录合并并保留元数据；冲突 ID 与关联一同重新分配。"
  },
  "m573": {
    "ru": "Области документов и aliases переносятся; остальные области документов сохраняются.",
    "en": "Document scopes and aliases move; other document scopes remain.",
    "zh-CN": "文档范围和别名将移动；其他文档范围保留。"
  },
  "m574": {
    "ru": "Исходный Notebook удаляется только после согласованного сохранения переноса.",
    "en": "The original Notebook is removed only after the move is saved consistently.",
    "zh-CN": "仅在移动一致保存后才删除原 Notebook。"
  },
  "m575": {
    "ru": "Git remote остаётся прежним; открытие старого репозитория по-прежнему определяет прежнюю Git-идентичность.",
    "en": "Git remote is unchanged; opening the old repository still resolves to its original Git identity.",
    "zh-CN": "Git remote 不变；打开旧仓库仍会识别为原 Git 标识。"
  },
  "m576": {
    "ru": "Регистрируются Git-идентичность и ассоциации каталога.",
    "en": "Git identity and directory associations are registered.",
    "zh-CN": "将注册 Git 标识和目录关联。"
  },
  "m577": {
    "ru": "Одинаковый текст, разные поля записи",
    "en": "Same text, different fields",
    "zh-CN": "正文相同，字段不同"
  },
  "m578": {
    "ru": "Повторяющийся ID в источнике",
    "en": "Duplicate ID in source",
    "zh-CN": "来源中 ID 重复"
  },
  "m579": {
    "ru": "Повторяющийся ID в цели",
    "en": "Duplicate ID in destination",
    "zh-CN": "目标中 ID 重复"
  },
  "m580": {
    "ru": "История совпавшей записи требует отдельного сопоставления",
    "en": "Matching record history requires separate reconciliation",
    "zh-CN": "匹配记录的历史需要单独核对"
  },
  "m581": {
    "ru": "Ассоциация принадлежит другому проекту",
    "en": "Association belongs to another project",
    "zh-CN": "关联属于其他项目"
  },
  "m582": {
    "ru": "Связь неоднозначна",
    "en": "Ambiguous link",
    "zh-CN": "关联不明确"
  },
  "m583": {
    "ru": "У совпавшего факта в цели нет ID",
    "en": "Matching destination fact has no ID",
    "zh-CN": "目标匹配事实没有 ID"
  },
  "m584": {
    "ru": "Повреждённая запись",
    "en": "Corrupt record",
    "zh-CN": "记录损坏"
  },
  "m585": {
    "ru": "Конфликтов: {0}. Изменение недоступно; исправьте записи или выберите другую цель.{1}",
    "en": "Conflicts: {0}. Changes unavailable; fix records or select another destination.{1}",
    "zh-CN": "冲突：{0}。无法更改；请修复记录或选择其他目标。{1}"
  },
  "m586": {
    "ru": " Показано до 100.",
    "en": " Showing up to 100.",
    "zh-CN": " 最多显示 100 项。"
  },
  "m587": {
    "ru": "Конфликтов нет. Проверьте последствия перед подтверждением.",
    "en": "No conflicts. Review consequences before confirming.",
    "zh-CN": "没有冲突。请检查影响后再确认。"
  },
  "m588": {
    "ru": "Для всех проектов",
    "en": "For all projects",
    "zh-CN": "适用于所有项目"
  },
  "m589": {
    "ru": "Требует проверки",
    "en": "Needs review",
    "zh-CN": "需要检查"
  },
  "m590": {
    "ru": "Проект не найден",
    "en": "Project not found",
    "zh-CN": "未找到项目"
  },
  "m591": {
    "ru": "Пока нет проектов",
    "en": "No projects yet",
    "zh-CN": "暂无项目"
  },
  "m592": {
    "ru": "Очистить поиск",
    "en": "Clear search",
    "zh-CN": "清除搜索"
  },
  "m593": {
    "ru": "Найдено: {0}",
    "en": "Found: {0}",
    "zh-CN": "找到：{0}"
  },
  "m594": {
    "ru": "Проектов и хранилищ: {0}",
    "en": "Projects and stores: {0}",
    "zh-CN": "项目和存储：{0}"
  },
  "m595": {
    "ru": "Выбрать область",
    "en": "Select scope",
    "zh-CN": "选择范围"
  },
  "m596": {
    "ru": "Последняя запись сервиса не изменена",
    "en": "Last service write unchanged",
    "zh-CN": "上次服务写入未更改"
  },
  "m597": {
    "ru": "Файл изменён вне сервиса",
    "en": "File modified outside the service",
    "zh-CN": "文件已被服务外部修改"
  },
  "m598": {
    "ru": "Владение файлом не подтверждено",
    "en": "File ownership unconfirmed",
    "zh-CN": "文件归属未确认"
  },
  "m599": {
    "ru": "Файл, владение, настройки клиента или глобальные инструкции изменились. Обновите статус и предпросмотр.",
    "en": "File, ownership, client settings or global instructions changed. Refresh status and preview.",
    "zh-CN": "文件、归属、客户端设置或全局指令已更改。请刷新状态和预览。"
  },
  "m600": {
    "ru": "Есть прерванная операция или повреждённое состояние владения. Проверьте файлы и журнал; восстановление доступно через memory-cli prompts recover --confirm.",
    "en": "An interrupted operation or corrupt ownership state exists. Check files and journal; recover with memory-cli prompts recover --confirm.",
    "zh-CN": "存在中断操作或损坏的归属状态。请检查文件和日志；可通过 memory-cli prompts recover --confirm 恢复。"
  },
  "m601": {
    "ru": "{0}: {1}. Перед повторной записью обновите статус.",
    "en": "{0}: {1}. Refresh status before writing again.",
    "zh-CN": "{0}：{1}。再次写入前请刷新状态。"
  },
  "m602": {
    "ru": "Состояние файлов: {0}. Активная сессия и использование агентом: нет данных.",
    "en": "File status: {0}. Active session and agent usage: no data.",
    "zh-CN": "文件状态：{0}。活动会话和代理使用情况：无数据。"
  },
  "m603": {
    "ru": "OpenCode передаёт инструкции через native-контекст; отдельный глобальный файл здесь не создаётся.",
    "en": "OpenCode delivers instructions through native context; no separate global file is created here.",
    "zh-CN": "OpenCode 通过原生上下文传递指令；此处不创建独立全局文件。"
  },
  "m604": {
    "ru": "Незавершённая операция: запись заблокирована до восстановления журнала.",
    "en": "Unfinished operation: writing blocked until journal recovery.",
    "zh-CN": "操作未完成：恢复日志前禁止写入。"
  },
  "m605": {
    "ru": "Статус недоступен: {0}",
    "en": "Status unavailable: {0}",
    "zh-CN": "状态不可用：{0}"
  },
  "m606": {
    "ru": "Файл существует",
    "en": "File exists",
    "zh-CN": "文件存在"
  },
  "m607": {
    "ru": "Файла нет",
    "en": "File missing",
    "zh-CN": "文件不存在"
  },
  "m608": {
    "ru": "есть",
    "en": "present",
    "zh-CN": "存在"
  },
  "m609": {
    "ru": "нет",
    "en": "absent",
    "zh-CN": "不存在"
  },
  "m610": {
    "ru": "Канал принадлежит marketplace-плагину. Файл пропускается при enable, disable и sync.",
    "en": "Marketplace plugin owns this channel. File is skipped during enable, disable and sync.",
    "zh-CN": "此渠道属于 marketplace 插件。启用、停用和同步时跳过此文件。"
  },
  "m611": {
    "ru": "Обнаружен конфликт подключений клиента.",
    "en": "Client connection conflict detected.",
    "zh-CN": "检测到客户端连接冲突。"
  },
  "m612": {
    "ru": "Канал принадлежит marketplace-плагину; файлы не изменяются.",
    "en": "Marketplace plugin owns this channel; files unchanged.",
    "zh-CN": "此渠道属于 marketplace 插件；文件不变。"
  },
  "m613": {
    "ru": "Статусы всех клиентов",
    "en": "All client statuses",
    "zh-CN": "所有客户端状态"
  },
  "m614": {
    "ru": "Пустой файл.",
    "en": "Empty file.",
    "zh-CN": "空文件。"
  },
  "m615": {
    "ru": "Marketplace-плагин управляет этим клиентом. Запись файла недоступна.",
    "en": "Marketplace plugin manages this client. File writing unavailable.",
    "zh-CN": "此客户端由 marketplace 插件管理。无法写入文件。"
  },
  "m616": {
    "ru": "Будет удалён неизменённый файл, созданный сервисом.",
    "en": "The unchanged service-created file will be deleted.",
    "zh-CN": "将删除服务创建且未更改的文件。"
  },
  "m617": {
    "ru": "Изменятся только managed-блоки. Остальной текст сохранится. Перед записью будет создана локальная резервная копия.",
    "en": "Only managed blocks will change. Other text stays. A local backup is created before writing.",
    "zh-CN": "仅更改受管区块，保留其他正文。写入前创建本地备份。"
  },
  "m618": {
    "ru": "Глобальные инструкции. Операция disable удаляет prompt/persona-блоки; MCP и плагин остаются подключёнными. Активная сессия может хранить прежний контекст.",
    "en": "Global instructions. Disable removes prompt/persona blocks; MCP and plugin remain connected. Active sessions may retain old context.",
    "zh-CN": "全局指令。停用会移除 prompt/persona 区块；MCP 和插件保持连接。活动会话可能保留旧上下文。"
  },
  "m619": {
    "ru": "Текущий файл · SHA-256: {0}",
    "en": "Current file · SHA-256: {0}",
    "zh-CN": "当前文件 · SHA-256：{0}"
  },
  "m620": {
    "ru": "Файл после операции",
    "en": "File after operation",
    "zh-CN": "操作后的文件"
  },
  "m621": {
    "ru": "После операции файла не будет",
    "en": "File will not exist after operation",
    "zh-CN": "操作后文件将不存在"
  },
  "m622": {
    "ru": "Шаблон prompt-блока",
    "en": "Prompt block template",
    "zh-CN": "Prompt 区块模板"
  },
  "m623": {
    "ru": "Prompt не добавляется этой операцией.",
    "en": "This operation does not add a prompt.",
    "zh-CN": "此操作不添加 prompt。"
  },
  "m624": {
    "ru": "Persona-блок из текущих глобальных инструкций",
    "en": "Persona block from current global instructions",
    "zh-CN": "由当前全局指令生成的 persona 区块"
  },
  "m625": {
    "ru": "Persona будет удалена.",
    "en": "Persona will be removed.",
    "zh-CN": "将移除 persona。"
  },
  "m626": {
    "ru": "Общий include-файл: {0}. {1}",
    "en": "Shared include file: {0}. {1}",
    "zh-CN": "共享 include 文件：{0}。{1}"
  },
  "m627": {
    "ru": "Будет обновлён; это также изменит содержимое include для других подключённых клиентов.",
    "en": "Will be updated; this also changes include content for other connected clients.",
    "zh-CN": "将更新；其他已连接客户端的 include 内容也会更改。"
  },
  "m628": {
    "ru": "Не изменяется: канал принадлежит плагину.",
    "en": "Unchanged: plugin owns the channel.",
    "zh-CN": "不变：此渠道属于插件。"
  },
  "m629": {
    "ru": "Не изменится.",
    "en": "Will not change.",
    "zh-CN": "保持不变。"
  },
  "m630": {
    "ru": "Отсутствует; эта операция не создаёт prompt include.",
    "en": "Absent; this operation does not create a prompt include.",
    "zh-CN": "不存在；此操作不创建 prompt include。"
  },
  "m631": {
    "ru": "Текущий общий include-файл",
    "en": "Current shared include file",
    "zh-CN": "当前共享 include 文件"
  },
  "m632": {
    "ru": "Общий include-файл после операции",
    "en": "Shared include file after operation",
    "zh-CN": "操作后的共享 include 文件"
  },
  "m633": {
    "ru": "{0}: {1}. {2} Активная сессия: нет данных.",
    "en": "{0}: {1}. {2} Active session: no data.",
    "zh-CN": "{0}：{1}。{2} 活动会话：无数据。"
  },
  "m634": {
    "ru": "Резервная копия: {0}.",
    "en": "Backup: {0}.",
    "zh-CN": "备份：{0}。"
  },
  "m635": {
    "ru": "{0} ГиБ",
    "en": "{0} GiB",
    "zh-CN": "{0} GiB"
  },
  "m636": {
    "ru": "Недоступно",
    "en": "Unavailable",
    "zh-CN": "不可用"
  },
  "m637": {
    "ru": "Выделенная память",
    "en": "Dedicated memory",
    "zh-CN": "专用内存"
  },
  "m638": {
    "ru": "Общая память",
    "en": "Shared memory",
    "zh-CN": "共享内存"
  },
  "m639": {
    "ru": "Unified Memory · общая память CPU и GPU",
    "en": "Unified Memory · shared CPU and GPU memory",
    "zh-CN": "统一内存 · CPU 与 GPU 共享"
  },
  "m640": {
    "ru": "Тип памяти не определён",
    "en": "Memory type unknown",
    "zh-CN": "内存类型未知"
  },
  "m641": {
    "ru": "Всего RAM",
    "en": "Total RAM",
    "zh-CN": "总 RAM"
  },
  "m642": {
    "ru": "Используется RAM",
    "en": "RAM used",
    "zh-CN": "已用 RAM"
  },
  "m643": {
    "ru": "RAM без свободных страниц",
    "en": "RAM excluding free pages",
    "zh-CN": "非空闲页 RAM"
  },
  "m644": {
    "ru": "Доступно RAM",
    "en": "Available RAM",
    "zh-CN": "可用 RAM"
  },
  "m645": {
    "ru": "Свободно RAM",
    "en": "Free RAM",
    "zh-CN": "空闲 RAM"
  },
  "m646": {
    "ru": "Используется swap",
    "en": "Swap used",
    "zh-CN": "已用交换空间"
  },
  "m647": {
    "ru": "Доступная RAM учитывает память, которую ОС может освободить для приложений.",
    "en": "Available RAM includes memory the OS can release for applications.",
    "zh-CN": "可用 RAM 包含操作系统可释放给应用的内存。"
  },
  "m648": {
    "ru": "Показатель включает кэш и другую память, которую ОС может освободить. Доступный приложениям объём отдельно не измерен.",
    "en": "Includes cache and other memory the OS can release. Memory available to applications was not measured separately.",
    "zh-CN": "包括缓存及操作系统可释放的其他内存。未单独测量应用可用内存。"
  },
  "m649": {
    "ru": "GPU не обнаружен.",
    "en": "No GPU detected.",
    "zh-CN": "未检测到 GPU。"
  },
  "m650": {
    "ru": "Данные GPU недоступны: драйвер или интерфейс мониторинга не найден.",
    "en": "GPU data unavailable: driver or monitoring interface not found.",
    "zh-CN": "GPU 数据不可用：未找到驱动或监测接口。"
  },
  "m651": {
    "ru": "Память GPU",
    "en": "GPU memory",
    "zh-CN": "GPU 内存"
  },
  "m652": {
    "ru": "Использует общую RAM; отдельный объём VRAM не применяется",
    "en": "Uses shared RAM; separate VRAM capacity does not apply",
    "zh-CN": "使用共享 RAM；无独立 VRAM 容量"
  },
  "m653": {
    "ru": "Расход GPU",
    "en": "GPU usage",
    "zh-CN": "GPU 使用量"
  },
  "m654": {
    "ru": "Недоступно через системный монитор",
    "en": "Unavailable through system monitoring",
    "zh-CN": "系统监测无法提供"
  },
  "m655": {
    "ru": "Используется выделенной памяти",
    "en": "Dedicated memory used",
    "zh-CN": "已用专用内存"
  },
  "m656": {
    "ru": "Всего выделенной памяти",
    "en": "Total dedicated memory",
    "zh-CN": "专用内存总量"
  },
  "m657": {
    "ru": "Используется общей RAM",
    "en": "Shared RAM used",
    "zh-CN": "已用共享 RAM"
  },
  "m658": {
    "ru": "Источник: {0}. Показатели GPU относятся ко всему адаптеру.",
    "en": "Source: {0}. GPU metrics cover the whole adapter.",
    "zh-CN": "来源：{0}。GPU 指标覆盖整个适配器。"
  },
  "m659": {
    "ru": "Панель",
    "en": "Dashboard",
    "zh-CN": "面板"
  },
  "m660": {
    "ru": "Клиент",
    "en": "Client",
    "zh-CN": "客户端"
  },
  "m661": {
    "ru": " · устаревшие данные",
    "en": " · stale data",
    "zh-CN": " · 数据已过期"
  },
  "m662": {
    "ru": "Обновлено: {0}. Автообновление каждые 3 с при видимой панели.",
    "en": "Updated: {0}. Refreshes every 3 s while the panel is visible.",
    "zh-CN": "更新于：{0}。面板可见时每 3 秒刷新。"
  },
  "m663": {
    "ru": "Мониторинг временно недоступен. Отображённые данные могли устареть; повторяем запрос.",
    "en": "Monitoring temporarily unavailable. Displayed data may be stale; retrying.",
    "zh-CN": "监测暂不可用。显示数据可能已过期；正在重试。"
  },
  "m664": {
    "ru": "Получаем показатели RAM и GPU…",
    "en": "Reading RAM and GPU metrics…",
    "zh-CN": "正在读取 RAM 和 GPU 指标…"
  },
  "m665": {
    "ru": "Поиск",
    "en": "Search",
    "zh-CN": "搜索"
  },
  "m666": {
    "ru": "Модели и вычисления",
    "en": "Models and compute",
    "zh-CN": "模型和计算"
  },
  "m667": {
    "ru": "Веб-панель",
    "en": "Web dashboard",
    "zh-CN": "网页面板"
  },
  "m668": {
    "ru": "Доступ к источникам",
    "en": "Source access",
    "zh-CN": "来源访问"
  },
  "m669": {
    "ru": "Есть правки в другом блоке. Сохраните их или отмените перед этой операцией.",
    "en": "Another section has edits. Save or discard them before this operation.",
    "zh-CN": "其他区块有更改。执行此操作前请保存或丢弃。"
  },
  "m670": {
    "ru": "Есть несохранённые настройки.",
    "en": "Unsaved settings.",
    "zh-CN": "有未保存的设置。"
  },
  "m671": {
    "ru": "Без изменений.",
    "en": "No changes.",
    "zh-CN": "没有更改。"
  },
  "m672": {
    "ru": "Для отправки требуется сохранённое облачное подключение.",
    "en": "Uploading requires a saved cloud connection.",
    "zh-CN": "上传需要已保存的云端连接。"
  },
  "m673": {
    "ru": "Расписание доступно в режиме «Локально + облачные снимки».",
    "en": "Scheduling requires Local + cloud snapshots mode.",
    "zh-CN": "计划任务需要“本地 + 云端快照”模式。"
  },
  "m674": {
    "ru": "Прежний режим only-cloud: включите облачные снимки для резервирования, затем явно восстановите скачанный локальный архив. До восстановления память недоступна.",
    "en": "Legacy only-cloud mode: enable cloud snapshots to back up, then explicitly restore the downloaded local archive. Memory is unavailable until recovery.",
    "zh-CN": "旧 only-cloud 模式：启用云端快照以备份，再手动恢复已下载的本地存档。恢复前记忆不可用。"
  },
  "m675": {
    "ru": "Прежний hybrid-sync: включение облачных снимков сначала сохранит локальную и старую облачную копии.",
    "en": "Legacy hybrid-sync: enabling cloud snapshots first saves local and old cloud copies.",
    "zh-CN": "旧 hybrid-sync 模式：启用云端快照会先保存本地和旧云端副本。"
  },
  "m676": {
    "ru": "{0} · источник: {1}. Доступность сети не проверялась.",
    "en": "{0} · source: {1}. Network availability unchecked.",
    "zh-CN": "{0} · 来源：{1}。未检查网络可用性。"
  },
  "m677": {
    "ru": "Подключение сохранено",
    "en": "Connection saved",
    "zh-CN": "连接已保存"
  },
  "m678": {
    "ru": "Подключение не задано",
    "en": "Connection not set",
    "zh-CN": "未设置连接"
  },
  "m679": {
    "ru": "Последний отправленный снимок",
    "en": "Last uploaded snapshot",
    "zh-CN": "最近上传的快照"
  },
  "m680": {
    "ru": "Ожидающий снимок",
    "en": "Pending snapshot",
    "zh-CN": "待处理快照"
  },
  "m681": {
    "ru": "Следующая отправка",
    "en": "Next upload",
    "zh-CN": "下次上传"
  },
  "m682": {
    "ru": "Расписание выключено",
    "en": "Schedule disabled",
    "zh-CN": "计划已停用"
  },
  "m683": {
    "ru": "Повтор после ошибки",
    "en": "Retry after error",
    "zh-CN": "错误后重试"
  },
  "m684": {
    "ru": "Квота блокирует отправку",
    "en": "Quota blocks upload",
    "zh-CN": "配额阻止上传"
  },
  "m685": {
    "ru": "Ошибка отправки",
    "en": "Upload error",
    "zh-CN": "上传错误"
  },
  "m686": {
    "ru": "Читаем локальные настройки…",
    "en": "Reading local settings…",
    "zh-CN": "正在读取本地设置…"
  },
  "m687": {
    "ru": "Не удалось загрузить настройки.",
    "en": "Could not load settings.",
    "zh-CN": "无法加载设置。"
  },
  "m688": {
    "ru": "Выполняем операцию…",
    "en": "Running operation…",
    "zh-CN": "正在执行操作…"
  },
  "m689": {
    "ru": "Настройки сохранены.",
    "en": "Settings saved.",
    "zh-CN": "设置已保存。"
  },
  "m690": {
    "ru": "Облачные снимки включены. Локальная резервная копия сохранена.",
    "en": "Cloud snapshots enabled. Local backup saved.",
    "zh-CN": "云端快照已启用。本地备份已保存。"
  },
  "m691": {
    "ru": "Подключение проверено: {0}.",
    "en": "Connection checked: {0}.",
    "zh-CN": "连接检查时间：{0}。"
  },
  "m692": {
    "ru": "Снимок отправлен в облако.",
    "en": "Snapshot uploaded to cloud.",
    "zh-CN": "快照已上传到云端。"
  },
  "m693": {
    "ru": "Память не изменилась; повторная отправка не требуется.",
    "en": "Memory unchanged; no need to upload again.",
    "zh-CN": "记忆未更改；无需再次上传。"
  },
  "m694": {
    "ru": "Локальный снимок сохранён.",
    "en": "Local snapshot saved.",
    "zh-CN": "本地快照已保存。"
  },
  "m695": {
    "ru": "Память восстановлена. Текущее состояние сохранено в резервном снимке.",
    "en": "Memory restored. Previous state saved in a backup snapshot.",
    "zh-CN": "记忆已恢复。此前状态已保存到备份快照。"
  },
  "m696": {
    "ru": "Выбранные снимки удалены.",
    "en": "Selected snapshots deleted.",
    "zh-CN": "所选快照已删除。"
  },
  "m697": {
    "ru": "Облачный архив сохранён локально: {0}. Загрузите локальный список и выберите «Восстановить» для этого архива.",
    "en": "Cloud archive saved locally: {0}. Load the local list and choose Restore for this archive.",
    "zh-CN": "云端存档已保存到本地：{0}。请加载本地列表并对此存档选择“恢复”。"
  },
  "m698": {
    "ru": "Операция завершена.",
    "en": "Operation completed.",
    "zh-CN": "操作已完成。"
  },
  "m699": {
    "ru": " Смена модели или размерности требует переиндексации в разделе «Модели»; векторы ещё не перестроены.",
    "en": " Changing model or dimensions requires reindexing under Models; vectors are not rebuilt yet.",
    "zh-CN": " 更改模型或维度后需在“模型”中重建索引；向量尚未重建。"
  },
  "m700": {
    "ru": " Новый порт применится после перезапуска панели.",
    "en": " New port applies after restarting the dashboard.",
    "zh-CN": " 新端口在重启面板后生效。"
  },
  "m701": {
    "ru": "Операция не завершена.",
    "en": "Operation incomplete.",
    "zh-CN": "操作未完成。"
  },
  "m702": {
    "ru": "Загружаем список…",
    "en": "Loading list…",
    "zh-CN": "正在加载列表…"
  },
  "m703": {
    "ru": "Снимков: {0}. Показаны последние 100.",
    "en": "Snapshots: {0}. Showing latest 100.",
    "zh-CN": "快照：{0}。显示最近 100 个。"
  },
  "m704": {
    "ru": "Снимков пока нет.",
    "en": "No snapshots yet.",
    "zh-CN": "暂无快照。"
  },
  "m705": {
    "ru": "{0} · {1} КБ{2}",
    "en": "{0} · {1} KB{2}",
    "zh-CN": "{0} · {1} KB{2}"
  },
  "m706": {
    "ru": " · Закреплён",
    "en": " · Pinned",
    "zh-CN": " · 已固定"
  },
  "m707": {
    "ru": "Восстановить",
    "en": "Restore",
    "zh-CN": "恢复"
  },
  "m708": {
    "ru": "Снять закрепление",
    "en": "Unpin",
    "zh-CN": "取消固定"
  },
  "m709": {
    "ru": "Закрепить",
    "en": "Pin",
    "zh-CN": "固定"
  },
  "m710": {
    "ru": "{0} снимок {1}",
    "en": "{0} snapshot {1}",
    "zh-CN": "{0} 快照 {1}"
  },
  "m711": {
    "ru": "Областей Notebook: {0}; документов: {1}; связей: {2}; чанков: {3}.",
    "en": "Notebook scopes: {0}; documents: {1}; links: {2}; chunks: {3}.",
    "zh-CN": "Notebook 范围：{0}；文档：{1}；关联：{2}；分块：{3}。"
  },
  "m712": {
    "ru": "Снимок",
    "en": "Snapshot",
    "zh-CN": "快照"
  },
  "m713": {
    "ru": "Текущее состояние",
    "en": "Current state",
    "zh-CN": "当前状态"
  },
  "m714": {
    "ru": "Состояние из снимка",
    "en": "Snapshot state",
    "zh-CN": "快照状态"
  },
  "m715": {
    "ru": "На компьютере",
    "en": "On this computer",
    "zh-CN": "本机"
  },
  "m716": {
    "ru": "В облаке",
    "en": "In cloud",
    "zh-CN": "云端"
  },
  "m717": {
    "ru": "{0} снимков, {1} КБ",
    "en": "{0} snapshots, {1} KB",
    "zh-CN": "{0} 个快照，{1} KB"
  },
  "m718": {
    "ru": "Рабочая память будет полностью заменена снимком. Перед восстановлением сохраняется резервная копия текущего состояния. Закройте другие клиенты памяти.",
    "en": "Working memory will be fully replaced by the snapshot. A backup of the current state is saved first. Close other memory clients.",
    "zh-CN": "工作记忆将被快照完全替换。恢复前会保存当前状态备份。请关闭其他记忆客户端。"
  },
  "m719": {
    "ru": "Будут удалены только снимки из предпросмотра. Рабочая память остаётся доступной.",
    "en": "Only previewed snapshots will be deleted. Working memory remains available.",
    "zh-CN": "仅删除预览中的快照。工作记忆仍可使用。"
  },
  "m720": {
    "ru": "Применить режим хранения?",
    "en": "Apply storage mode?",
    "zh-CN": "应用存储模式？"
  },
  "m721": {
    "ru": "Изменить расписание отправки снимков?",
    "en": "Change snapshot upload schedule?",
    "zh-CN": "更改快照上传计划？"
  },
  "m722": {
    "ru": "Отправка",
    "en": "Upload",
    "zh-CN": "上传"
  },
  "m723": {
    "ru": "Интервал, часов",
    "en": "Interval, hours",
    "zh-CN": "间隔（小时）"
  },
  "m724": {
    "ru": "Нет изменённых настроек.",
    "en": "No changed settings.",
    "zh-CN": "没有已更改的设置。"
  },
  "m725": {
    "ru": "Настройки сохраняются для всех клиентов. Смена embedding-модели или размерности требует отдельной переиндексации.",
    "en": "Settings apply to all clients. Changing embedding model or dimensions requires separate reindexing.",
    "zh-CN": "设置适用于所有客户端。更改嵌入模型或维度需要单独重建索引。"
  },
  "m726": {
    "ru": "Сохранить подключение в зашифрованном хранилище? Проверка сети выполняется отдельно.",
    "en": "Save connection in encrypted storage? Network check is separate.",
    "zh-CN": "将连接保存到加密存储？网络检查需单独执行。"
  },
  "m727": {
    "ru": "URL базы",
    "en": "Database URL",
    "zh-CN": "数据库 URL"
  },
  "m728": {
    "ru": "Удалить сохранённые секреты и перейти к локальному режиму? Учётные данные из окружения остаются заданными.",
    "en": "Delete saved secrets and switch to local mode? Environment credentials remain set.",
    "zh-CN": "删除已保存凭据并切换至本地模式？环境凭据仍会保留。"
  },
  "m729": {
    "ru": "не найдено",
    "en": "not found",
    "zh-CN": "未找到"
  },
  "m730": {
    "ru": "чужая регистрация сохранена",
    "en": "foreign registration retained",
    "zh-CN": "已保留其他应用的注册"
  },
  "m731": {
    "ru": "изменённый или чужой skill сохранён",
    "en": "modified or foreign skill retained",
    "zh-CN": "已保留修改过或其他应用的技能"
  },
  "m732": {
    "ru": "управляется marketplace; используйте управление плагинами клиента",
    "en": "managed by marketplace; use client plugin management",
    "zh-CN": "由 marketplace 管理；请使用客户端插件管理"
  },
  "m733": {
    "ru": "Файлы клиента или состояние восстановления изменились. Обновите состояние и проверьте список снова.",
    "en": "Client files or recovery state changed. Refresh status and review the list again.",
    "zh-CN": "客户端文件或恢复状态已更改。请刷新状态并重新检查列表。"
  },
  "m734": {
    "ru": "Подтвердить восстановление",
    "en": "Confirm recovery",
    "zh-CN": "确认恢复"
  },
  "m735": {
    "ru": "Подтвердить удаление интеграции",
    "en": "Confirm integration removal",
    "zh-CN": "确认移除集成"
  },
  "m736": {
    "ru": "Состояние клиента недоступно.",
    "en": "Client status unavailable.",
    "zh-CN": "客户端状态不可用。"
  },
  "m737": {
    "ru": "{0}: файлов к изменению — {1}. Канал: {2}. Проверено: {3}.",
    "en": "{0}: {1} files to change. Channel: {2}. Checked: {3}.",
    "zh-CN": "{0}：将更改 {1} 个文件。渠道：{2}。检查时间：{3}。"
  },
  "m738": {
    "ru": "Выберите клиента, проверьте точные файлы и подтвердите действие.",
    "en": "Select a client, review the exact files and confirm.",
    "zh-CN": "请选择客户端，检查具体文件后确认。"
  },
  "m739": {
    "ru": " Есть прерванная операция. Сначала восстановите её по квитанции.",
    "en": " An operation was interrupted. Recover it using its receipt first.",
    "zh-CN": " 存在中断操作。请先通过回执恢复。"
  },
  "m740": {
    "ru": "{0} · {1} · {2} / {3} · обработано {4} · {5}",
    "en": "{0} · {1} · {2} / {3} · processed {4} · {5}",
    "zh-CN": "{0} · {1} · {2} / {3} · 已处理 {4} · {5}"
  },
  "m741": {
    "ru": "Состояние файлов недоступно.",
    "en": "File status unavailable.",
    "zh-CN": "文件状态不可用。"
  },
  "m742": {
    "ru": "Проверяются файлы клиента…",
    "en": "Checking client files…",
    "zh-CN": "正在检查客户端文件…"
  },
  "m743": {
    "ru": "восстановление",
    "en": "recovery",
    "zh-CN": "恢复"
  },
  "m744": {
    "ru": "удаление интеграции",
    "en": "integration removal",
    "zh-CN": "移除集成"
  },
  "m745": {
    "ru": "Область: глобальные файлы выбранного клиента. Файлов: {0}.",
    "en": "Scope: selected client's global files. Files: {0}.",
    "zh-CN": "范围：所选客户端的全局文件。文件数：{0}。"
  },
  "m746": {
    "ru": "{0}: {1} · {2} → {3} байт",
    "en": "{0}: {1} · {2} → {3} bytes",
    "zh-CN": "{0}：{1} · {2} → {3} 字节"
  },
  "m747": {
    "ru": "Удалить",
    "en": "Delete",
    "zh-CN": "删除"
  },
  "m748": {
    "ru": "Обновить",
    "en": "Update",
    "zh-CN": "更新"
  },
  "m749": {
    "ru": "Сохранено / пропущено",
    "en": "Kept / skipped",
    "zh-CN": "保留 / 跳过"
  },
  "m750": {
    "ru": "Удаление заблокировано до восстановления прерванной операции.",
    "en": "Removal blocked until the interrupted operation is recovered.",
    "zh-CN": "中断操作恢复前无法移除。"
  },
  "m751": {
    "ru": "Этот канал управляется marketplace. Изменения недоступны.",
    "en": "This channel is managed by marketplace. Changes unavailable.",
    "zh-CN": "此渠道由 marketplace 管理。无法更改。"
  },
  "m752": {
    "ru": "Файлы уже восстановлены. Подтверждение закроет состояние прерванной операции.",
    "en": "Files already restored. Confirmation closes the interrupted operation state.",
    "zh-CN": "文件已恢复。确认将关闭中断操作状态。"
  },
  "m753": {
    "ru": "Принадлежащих плагину файлов для удаления нет.",
    "en": "No plugin-owned files to remove.",
    "zh-CN": "没有可移除的插件所属文件。"
  },
  "m754": {
    "ru": "Содержимое конфигураций скрыто: оно может включать секреты. Перед изменением сохраняется и проверяется локальная резервная копия.",
    "en": "Configuration contents hidden: they may contain secrets. A local backup is saved and verified before changes.",
    "zh-CN": "配置内容已隐藏，可能包含凭据。更改前会保存并验证本地备份。"
  },
  "m755": {
    "ru": "{0}. Обработано: {1}. Квитанция: {2}.",
    "en": "{0}. Processed: {1}. Receipt: {2}.",
    "zh-CN": "{0}。已处理：{1}。回执：{2}。"
  },
  "m756": {
    "ru": "Memory — Все записи",
    "en": "Memory — All records",
    "zh-CN": "Memory — 全部记录"
  },
  "m757": {
    "ru": "Перейти к записям",
    "en": "Skip to records",
    "zh-CN": "跳转到记录"
  },
  "m758": {
    "ru": "Навигация и область памяти",
    "en": "Navigation and memory scope",
    "zh-CN": "导航和记忆范围"
  },
  "m759": {
    "ru": "Разделы памяти",
    "en": "Memory sections",
    "zh-CN": "记忆分区"
  },
  "m760": {
    "ru": "Проект или глобальная память",
    "en": "Project or global memory",
    "zh-CN": "项目或全局记忆"
  },
  "m761": {
    "ru": "Выбор области памяти",
    "en": "Select memory scope",
    "zh-CN": "选择记忆范围"
  },
  "m762": {
    "ru": "Найти проект",
    "en": "Find project",
    "zh-CN": "查找项目"
  },
  "m763": {
    "ru": "Найти проект…",
    "en": "Find project…",
    "zh-CN": "查找项目…"
  },
  "m764": {
    "ru": "Управление проектами",
    "en": "Manage projects",
    "zh-CN": "管理项目"
  },
  "m765": {
    "ru": "Тема",
    "en": "Theme",
    "zh-CN": "主题"
  },
  "m766": {
    "ru": "Системная",
    "en": "System",
    "zh-CN": "跟随系统"
  },
  "m767": {
    "ru": "Светлая",
    "en": "Light",
    "zh-CN": "浅色"
  },
  "m768": {
    "ru": "Тёмная",
    "en": "Dark",
    "zh-CN": "深色"
  },
  "m769": {
    "ru": "На этом компьютере",
    "en": "On this computer",
    "zh-CN": "本机"
  },
  "m770": {
    "ru": "Обслуживание",
    "en": "Maintenance",
    "zh-CN": "维护"
  },
  "m771": {
    "ru": "Диагностика и файлы RAG",
    "en": "Diagnostics and RAG files",
    "zh-CN": "诊断和 RAG 文件"
  },
  "m772": {
    "ru": "Удаление интеграции",
    "en": "Remove integration",
    "zh-CN": "移除集成"
  },
  "m773": {
    "ru": "Клиентские интеграции",
    "en": "Client integrations",
    "zh-CN": "客户端集成"
  },
  "m774": {
    "ru": "Состояние хранилища",
    "en": "Storage status",
    "zh-CN": "存储状态"
  },
  "m775": {
    "ru": "Файлы клиентов",
    "en": "Client files",
    "zh-CN": "客户端文件"
  },
  "m776": {
    "ru": "Предпросмотр",
    "en": "Preview",
    "zh-CN": "预览"
  },
  "m777": {
    "ru": "Правила",
    "en": "Rules",
    "zh-CN": "规则"
  },
  "m778": {
    "ru": "Файлы панели обновились после её запуска. Чтобы открыть новую версию, выполните",
    "en": "Dashboard files changed since launch. To open the new version, run",
    "zh-CN": "面板文件在启动后已更新。要打开新版本，请运行"
  },
  "m779": {
    "ru": "и обновите страницу.",
    "en": "and refresh the page.",
    "zh-CN": "并刷新页面。"
  },
  "m780": {
    "ru": "Список записей",
    "en": "Record list",
    "zh-CN": "记录列表"
  },
  "m781": {
    "ru": "Поиск записей",
    "en": "Search records",
    "zh-CN": "搜索记录"
  },
  "m782": {
    "ru": "Найти в памяти…",
    "en": "Search memory…",
    "zh-CN": "搜索记忆…"
  },
  "m783": {
    "ru": "Состояние записей",
    "en": "Record status",
    "zh-CN": "记录状态"
  },
  "m784": {
    "ru": "Все состояния",
    "en": "All statuses",
    "zh-CN": "所有状态"
  },
  "m785": {
    "ru": "Защищённые",
    "en": "Protected",
    "zh-CN": "已保护"
  },
  "m786": {
    "ru": "Выключенные",
    "en": "Disabled",
    "zh-CN": "已停用"
  },
  "m787": {
    "ru": "Заменённые",
    "en": "Superseded",
    "zh-CN": "已替代"
  },
  "m788": {
    "ru": "Все хранилища",
    "en": "All stores",
    "zh-CN": "所有存储"
  },
  "m789": {
    "ru": "Для правки откройте хранилище выбранной записи.",
    "en": "Open the selected record's store to edit.",
    "zh-CN": "请打开所选记录的存储以编辑。"
  },
  "m790": {
    "ru": "Дополнительные фильтры",
    "en": "More filters",
    "zh-CN": "更多筛选"
  },
  "m791": {
    "ru": "Сбросить фильтры",
    "en": "Reset filters",
    "zh-CN": "重置筛选"
  },
  "m792": {
    "ru": "Тип записи",
    "en": "Record type",
    "zh-CN": "记录类型"
  },
  "m793": {
    "ru": "Факты и инструкции",
    "en": "Facts and instructions",
    "zh-CN": "事实和指令"
  },
  "m794": {
    "ru": "Факты",
    "en": "Facts",
    "zh-CN": "事实"
  },
  "m795": {
    "ru": "Через запятую",
    "en": "Comma-separated",
    "zh-CN": "用逗号分隔"
  },
  "m796": {
    "ru": "Любой из указанных тегов, полное совпадение.",
    "en": "Any listed tag, exact match.",
    "zh-CN": "精确匹配任一指定标签。"
  },
  "m797": {
    "ru": "Создана с",
    "en": "Created from",
    "zh-CN": "创建日期起"
  },
  "m798": {
    "ru": "По дату",
    "en": "Through date",
    "zh-CN": "截止日期"
  },
  "m799": {
    "ru": "Подключение…",
    "en": "Connecting…",
    "zh-CN": "正在连接…"
  },
  "m800": {
    "ru": "Содержимое записи",
    "en": "Record content",
    "zh-CN": "记录内容"
  },
  "m801": {
    "ru": "Выберите запись",
    "en": "Select a record",
    "zh-CN": "选择记录"
  },
  "m802": {
    "ru": "Её текст, свойства и источники появятся здесь.",
    "en": "Its text, properties and sources will appear here.",
    "zh-CN": "此处将显示正文、属性和来源。"
  },
  "m803": {
    "ru": "К списку",
    "en": "Back to list",
    "zh-CN": "返回列表"
  },
  "m804": {
    "ru": "Редактировать",
    "en": "Edit",
    "zh-CN": "编辑"
  },
  "m805": {
    "ru": "Свойства записи",
    "en": "Record properties",
    "zh-CN": "记录属性"
  },
  "m806": {
    "ru": "Связанные источники",
    "en": "Linked sources",
    "zh-CN": "关联来源"
  },
  "m807": {
    "ru": "Legacy-связи требуют проверки актуальности после обновления источника.",
    "en": "Legacy links need freshness review after a source update.",
    "zh-CN": "来源更新后需检查旧关联是否仍有效。"
  },
  "m808": {
    "ru": "Открыть хранилище записи",
    "en": "Open record store",
    "zh-CN": "打开记录存储"
  },
  "m809": {
    "ru": "Перенести инструкцию",
    "en": "Move instruction",
    "zh-CN": "移动指令"
  },
  "m810": {
    "ru": "Заменить новой записью",
    "en": "Supersede with new record",
    "zh-CN": "用新记录替代"
  },
  "m811": {
    "ru": "Добавить связь с источником",
    "en": "Add source link",
    "zh-CN": "添加来源关联"
  },
  "m812": {
    "ru": "Редактирование",
    "en": "Editing",
    "zh-CN": "编辑"
  },
  "m813": {
    "ru": "Краткий факт или правило. Notebook хранит текст одной строкой.",
    "en": "A short fact or rule. Notebook stores text as a single line.",
    "zh-CN": "简短事实或规则。Notebook 以单行保存正文。"
  },
  "m814": {
    "ru": "Например: 90d, 2w, 24h",
    "en": "For example: 90d, 2w, 24h",
    "zh-CN": "例如：90d、2w、24h"
  },
  "m815": {
    "ru": "Защитить от удаления",
    "en": "Protect from deletion",
    "zh-CN": "启用删除保护"
  },
  "m816": {
    "ru": "Для удаления потребуется отдельное подтверждение",
    "en": "Deletion will require separate confirmation",
    "zh-CN": "删除时需要单独确认"
  },
  "m817": {
    "ru": "Выключить инструкцию",
    "en": "Disable instruction",
    "zh-CN": "停用指令"
  },
  "m818": {
    "ru": "Останется в памяти, но не войдёт в действующую персону",
    "en": "Stays in memory but is excluded from active persona",
    "zh-CN": "保留在记忆中，但不包含在活动 persona 中"
  },
  "m819": {
    "ru": "Отмена",
    "en": "Cancel",
    "zh-CN": "取消"
  },
  "m820": {
    "ru": "Проверить и сохранить",
    "en": "Review and save",
    "zh-CN": "检查并保存"
  },
  "m821": {
    "ru": "Сохранённые знания",
    "en": "Saved knowledge",
    "zh-CN": "已保存的知识"
  },
  "m822": {
    "ru": "Notes и источники",
    "en": "Notes and sources",
    "zh-CN": "笔记和来源"
  },
  "m823": {
    "ru": "Новая Note",
    "en": "New Note",
    "zh-CN": "新建笔记"
  },
  "m824": {
    "ru": "Пробный поиск",
    "en": "Trial search",
    "zh-CN": "试用搜索"
  },
  "m825": {
    "ru": "Граф области",
    "en": "Scope graph",
    "zh-CN": "范围图谱"
  },
  "m826": {
    "ru": "Найти источник или Note",
    "en": "Find source or Note",
    "zh-CN": "查找来源或笔记"
  },
  "m827": {
    "ru": "Найти",
    "en": "Find",
    "zh-CN": "查找"
  },
  "m828": {
    "ru": "Все знания",
    "en": "All knowledge",
    "zh-CN": "全部知识"
  },
  "m829": {
    "ru": "Внешние источники",
    "en": "External sources",
    "zh-CN": "外部来源"
  },
  "m830": {
    "ru": "Включить глобальные источники",
    "en": "Include global sources",
    "zh-CN": "包含全局来源"
  },
  "m831": {
    "ru": "Назад",
    "en": "Previous",
    "zh-CN": "上一页"
  },
  "m832": {
    "ru": "Далее",
    "en": "Next",
    "zh-CN": "下一页"
  },
  "m833": {
    "ru": "Инспектор источника",
    "en": "Source inspector",
    "zh-CN": "来源详情"
  },
  "m834": {
    "ru": "Выберите источник",
    "en": "Select a source",
    "zh-CN": "选择来源"
  },
  "m835": {
    "ru": "Сохранённый текст, разделы, чанки и связанные факты появятся здесь.",
    "en": "Saved text, sections, chunks and linked facts will appear here.",
    "zh-CN": "此处将显示已保存正文、章节、分块和关联事实。"
  },
  "m836": {
    "ru": "Редактировать Note",
    "en": "Edit Note",
    "zh-CN": "编辑笔记"
  },
  "m837": {
    "ru": "Обновить источник",
    "en": "Refresh source",
    "zh-CN": "刷新来源"
  },
  "m838": {
    "ru": "Метаданные",
    "en": "Metadata",
    "zh-CN": "元数据"
  },
  "m839": {
    "ru": "Граф источника",
    "en": "Source graph",
    "zh-CN": "来源图谱"
  },
  "m840": {
    "ru": "Убрать из области",
    "en": "Remove from scope",
    "zh-CN": "从范围移除"
  },
  "m841": {
    "ru": "Удалить полностью",
    "en": "Delete entirely",
    "zh-CN": "彻底删除"
  },
  "m842": {
    "ru": "Сохранённый текст",
    "en": "Saved text",
    "zh-CN": "已保存正文"
  },
  "m843": {
    "ru": "Читать дальше",
    "en": "Read more",
    "zh-CN": "继续阅读"
  },
  "m844": {
    "ru": "Разделы и чанки",
    "en": "Sections and chunks",
    "zh-CN": "章节和分块"
  },
  "m845": {
    "ru": "Уровень иерархии",
    "en": "Hierarchy level",
    "zh-CN": "层级"
  },
  "m846": {
    "ru": "Предыдущие чанки",
    "en": "Previous chunks",
    "zh-CN": "上一组分块"
  },
  "m847": {
    "ru": "Следующие чанки",
    "en": "Next chunks",
    "zh-CN": "下一组分块"
  },
  "m848": {
    "ru": "Продолжить чанк",
    "en": "Continue chunk",
    "zh-CN": "继续读取分块"
  },
  "m849": {
    "ru": "Связанные факты",
    "en": "Linked facts",
    "zh-CN": "关联事实"
  },
  "m850": {
    "ru": "Связать с фактом",
    "en": "Link to fact",
    "zh-CN": "关联事实"
  },
  "m851": {
    "ru": "Ещё связи",
    "en": "More links",
    "zh-CN": "更多关联"
  },
  "m852": {
    "ru": "Закрыть",
    "en": "Close",
    "zh-CN": "关闭"
  },
  "m853": {
    "ru": "Вернуться к правке",
    "en": "Return to editing",
    "zh-CN": "返回编辑"
  },
  "m854": {
    "ru": "Обновить и сравнить",
    "en": "Refresh and compare",
    "zh-CN": "刷新并比较"
  },
  "m855": {
    "ru": "Удаление из памяти",
    "en": "Delete from memory",
    "zh-CN": "从记忆删除"
  },
  "m856": {
    "ru": "Удалить эту запись?",
    "en": "Delete this record?",
    "zh-CN": "删除此记录？"
  },
  "m857": {
    "ru": "Запись будет удалена из выбранной области. Эта операция не имеет отмены.",
    "en": "Record will be deleted from the selected scope. This cannot be undone.",
    "zh-CN": "将从所选范围删除记录。此操作无法撤销。"
  },
  "m858": {
    "ru": "Подтверждаю удаление защищённой записи",
    "en": "I confirm deletion of the protected record",
    "zh-CN": "确认删除受保护记录"
  },
  "m859": {
    "ru": "Несохранённые изменения",
    "en": "Unsaved changes",
    "zh-CN": "未保存的更改"
  },
  "m860": {
    "ru": "В редакторе есть несохранённый текст. Если перейти дальше, изменения будут потеряны.",
    "en": "The editor has unsaved text. Continuing will lose these changes.",
    "zh-CN": "编辑器中有未保存正文。继续将丢失这些更改。"
  },
  "m861": {
    "ru": "Не сохранять",
    "en": "Discard changes",
    "zh-CN": "丢弃更改"
  },
  "m862": {
    "ru": "Продолжить правку",
    "en": "Keep editing",
    "zh-CN": "继续编辑"
  },
  "m863": {
    "ru": "Действие",
    "en": "Action",
    "zh-CN": "操作"
  },
  "m864": {
    "ru": "Привязать Git-каталог",
    "en": "Link Git directory",
    "zh-CN": "关联 Git 目录"
  },
  "m865": {
    "ru": "Полный путь Git-каталога",
    "en": "Full Git directory path",
    "zh-CN": "Git 目录完整路径"
  },
  "m866": {
    "ru": "Исходный проект или хранилище",
    "en": "Source project or store",
    "zh-CN": "来源项目或存储"
  },
  "m867": {
    "ru": "Зарегистрированные ассоциации",
    "en": "Registered associations",
    "zh-CN": "已注册关联"
  },
  "m868": {
    "ru": "Отвязать этот каталог",
    "en": "Unlink this directory",
    "zh-CN": "取消此目录关联"
  },
  "m869": {
    "ru": "Целевой Git-проект",
    "en": "Destination Git project",
    "zh-CN": "目标 Git 项目"
  },
  "m870": {
    "ru": "Последствия изменения",
    "en": "Consequences",
    "zh-CN": "影响"
  },
  "m871": {
    "ru": "Подтвердить изменение",
    "en": "Confirm change",
    "zh-CN": "确认更改"
  },
  "m872": {
    "ru": "Перенос инструкции",
    "en": "Move instruction",
    "zh-CN": "移动指令"
  },
  "m873": {
    "ru": "Целевое хранилище",
    "en": "Destination store",
    "zh-CN": "目标存储"
  },
  "m874": {
    "ru": "Разрешить открыть связанные источники целевой области, сохранив прежние области",
    "en": "Allow linked sources to be shared with the destination, keeping existing scopes",
    "zh-CN": "允许向目标范围开放关联来源，保留原有范围"
  },
  "m875": {
    "ru": "Проверяем обе области и связи…",
    "en": "Checking both scopes and links…",
    "zh-CN": "正在检查两个范围和关联…"
  },
  "m876": {
    "ru": "Подтверждаю открытие перечисленных источников целевой области",
    "en": "I confirm sharing the listed sources with the destination",
    "zh-CN": "确认向目标范围开放所列来源"
  },
  "m877": {
    "ru": "Обновить предпросмотр",
    "en": "Refresh preview",
    "zh-CN": "刷新预览"
  },
  "m878": {
    "ru": "Подтвердить перенос",
    "en": "Confirm move",
    "zh-CN": "确认移动"
  },
  "m879": {
    "ru": "Статус читает локальные файлы. Проверка запускается отдельно и показывает результат конкретного процесса.",
    "en": "Status reads local files. A separate check shows the result of a specific process.",
    "zh-CN": "状态读取本地文件。单独运行的检查显示具体进程结果。"
  },
  "m880": {
    "ru": "Проверка",
    "en": "Check",
    "zh-CN": "检查"
  },
  "m881": {
    "ru": "Адаптер памяти (MCP)",
    "en": "Memory adapter (MCP)",
    "zh-CN": "记忆适配器（MCP）"
  },
  "m882": {
    "ru": "Лимит 20 секунд и 256 KiB вывода. Проверка адаптера поддерживает один принадлежащий плагину Node/boot.js или Codex/Claude marketplace. Npx, чужие команды и проектные переопределения не запускаются.",
    "en": "Limit: 20 seconds and 256 KiB of output. Adapter check supports one plugin-owned Node/boot.js or Codex/Claude marketplace. Npx, foreign commands and project overrides are not run.",
    "zh-CN": "限制：20 秒和 256 KiB 输出。适配器检查支持单个插件所属 Node/boot.js 或 Codex/Claude marketplace。不会运行 npx、其他应用命令或项目覆盖配置。"
  },
  "m883": {
    "ru": "Обновить статус",
    "en": "Refresh status",
    "zh-CN": "刷新状态"
  },
  "m884": {
    "ru": "Удаление интеграции клиента",
    "en": "Remove client integration",
    "zh-CN": "移除客户端集成"
  },
  "m885": {
    "ru": "Удалить глобальную интеграцию",
    "en": "Remove global integration",
    "zh-CN": "移除全局集成"
  },
  "m886": {
    "ru": "Восстановить файлы из резервной копии",
    "en": "Restore files from backup",
    "zh-CN": "从备份恢复文件"
  },
  "m887": {
    "ru": "Квитанция удаления выбранного клиента",
    "en": "Selected client's removal receipt",
    "zh-CN": "所选客户端的移除回执"
  },
  "m888": {
    "ru": "Обновить состояние",
    "en": "Refresh state",
    "zh-CN": "刷新状态"
  },
  "m889": {
    "ru": "Квитанции операций",
    "en": "Operation receipts",
    "zh-CN": "操作回执"
  },
  "m890": {
    "ru": "Операция",
    "en": "Operation",
    "zh-CN": "操作"
  },
  "m891": {
    "ru": "Проверить движок во временном хранилище",
    "en": "Check engine in temporary storage",
    "zh-CN": "在临时存储检查引擎"
  },
  "m892": {
    "ru": "Очистить неиспользуемые файлы RAG",
    "en": "Clean unused RAG files",
    "zh-CN": "清理未使用的 RAG 文件"
  },
  "m893": {
    "ru": "Восстановить файлы из резервного ZIP",
    "en": "Restore files from backup ZIP",
    "zh-CN": "从备份 ZIP 恢复文件"
  },
  "m894": {
    "ru": "Продолжить прерванную очистку",
    "en": "Resume interrupted cleanup",
    "zh-CN": "继续中断的清理"
  },
  "m895": {
    "ru": "Квитанция с резервным ZIP",
    "en": "Receipt with backup ZIP",
    "zh-CN": "含备份 ZIP 的回执"
  },
  "m896": {
    "ru": "Квитанции операций с файлами",
    "en": "File operation receipts",
    "zh-CN": "文件操作回执"
  },
  "m897": {
    "ru": "Подтвердить проверенную операцию",
    "en": "Confirm reviewed operation",
    "zh-CN": "确认已检查的操作"
  },
  "m898": {
    "ru": "Обслуживание памяти",
    "en": "Memory maintenance",
    "zh-CN": "记忆维护"
  },
  "m899": {
    "ru": "Локальные операции. Перед записью проверьте область и изменения. Операции RAG охватывают все локальные области знаний.",
    "en": "Local operations. Review scope and changes before writing. RAG operations affect all local knowledge scopes.",
    "zh-CN": "本地操作。写入前请检查范围和更改。RAG 操作影响所有本地知识范围。"
  },
  "m900": {
    "ru": "Добавить legacy-заголовки",
    "en": "Add legacy titles",
    "zh-CN": "添加旧记录标题"
  },
  "m901": {
    "ru": "Уточнить legacy-инструкции",
    "en": "Review legacy instructions",
    "zh-CN": "整理旧指令"
  },
  "m902": {
    "ru": "Сбросить настройки поиска, моделей и источников",
    "en": "Reset search, model and source settings",
    "zh-CN": "重置搜索、模型和来源设置"
  },
  "m903": {
    "ru": "Восстановить настройки из резервной копии",
    "en": "Restore settings from backup",
    "zh-CN": "从备份恢复设置"
  },
  "m904": {
    "ru": "Экспортировать все локальные знания RAG",
    "en": "Export all local RAG knowledge",
    "zh-CN": "导出所有本地 RAG 知识"
  },
  "m905": {
    "ru": "Импортировать снимок RAG",
    "en": "Import RAG snapshot",
    "zh-CN": "导入 RAG 快照"
  },
  "m906": {
    "ru": "Сбросить все локальные знания RAG",
    "en": "Reset all local RAG knowledge",
    "zh-CN": "重置所有本地 RAG 知识"
  },
  "m907": {
    "ru": "Хранилище Notebook",
    "en": "Notebook store",
    "zh-CN": "Notebook 存储"
  },
  "m908": {
    "ru": "Резервная копия настроек",
    "en": "Settings backup",
    "zh-CN": "设置备份"
  },
  "m909": {
    "ru": "Добавить файл снимка",
    "en": "Add snapshot file",
    "zh-CN": "添加快照文件"
  },
  "m910": {
    "ru": "JSON / JSON.gz до 32 МиБ; распакованный JSON до 128 МиБ. Файл проверяется и сохраняется локально для предпросмотра.",
    "en": "JSON / JSON.gz up to 32 MiB; unpacked JSON up to 128 MiB. File is validated and saved locally for preview.",
    "zh-CN": "JSON / JSON.gz 最大 32 MiB；解压后的 JSON 最大 128 MiB。文件将验证并保存在本地供预览。"
  },
  "m911": {
    "ru": "Проверенный снимок RAG",
    "en": "Validated RAG snapshot",
    "zh-CN": "已验证的 RAG 快照"
  },
  "m912": {
    "ru": "Скачать выбранный снимок",
    "en": "Download selected snapshot",
    "zh-CN": "下载所选快照"
  },
  "m913": {
    "ru": "Режим импорта",
    "en": "Import mode",
    "zh-CN": "导入模式"
  },
  "m914": {
    "ru": "Объединить: заменить затронутые документы целиком",
    "en": "Merge: replace affected documents entirely",
    "zh-CN": "合并：完整替换受影响文档"
  },
  "m915": {
    "ru": "Заменить все локальные знания RAG",
    "en": "Replace all local RAG knowledge",
    "zh-CN": "替换所有本地 RAG 知识"
  },
  "m916": {
    "ru": "Последние завершённые операции RAG",
    "en": "Recent completed RAG operations",
    "zh-CN": "最近完成的 RAG 操作"
  },
  "m917": {
    "ru": "Подтвердить изменения",
    "en": "Confirm changes",
    "zh-CN": "确认更改"
  },
  "m918": {
    "ru": "Клиентские файлы инструкций",
    "en": "Client instruction files",
    "zh-CN": "客户端指令文件"
  },
  "m919": {
    "ru": "Глобальные prompt/persona-файлы клиентов. Просмотр не записывает файлы. Выберите клиента и действие, затем проверьте изменения.",
    "en": "Global client prompt/persona files. Viewing does not write files. Select a client and action, then review changes.",
    "zh-CN": "客户端全局 prompt/persona 文件。查看不会写入文件。请选择客户端和操作，然后检查更改。"
  },
  "m920": {
    "ru": "Клиент файла",
    "en": "File client",
    "zh-CN": "文件所属客户端"
  },
  "m921": {
    "ru": "Действие с файлом",
    "en": "File action",
    "zh-CN": "文件操作"
  },
  "m922": {
    "ru": "Включить prompt и persona",
    "en": "Enable prompt and persona",
    "zh-CN": "启用 prompt 和 persona"
  },
  "m923": {
    "ru": "Синхронизировать persona",
    "en": "Sync persona",
    "zh-CN": "同步 persona"
  },
  "m924": {
    "ru": "Удалить prompt и persona",
    "en": "Remove prompt and persona",
    "zh-CN": "移除 prompt 和 persona"
  },
  "m925": {
    "ru": "Обновить статус файлов",
    "en": "Refresh file status",
    "zh-CN": "刷新文件状态"
  },
  "m926": {
    "ru": "Читаем состояние клиентских файлов…",
    "en": "Reading client file status…",
    "zh-CN": "正在读取客户端文件状态…"
  },
  "m927": {
    "ru": "Подтвердить запись файлов",
    "en": "Confirm file write",
    "zh-CN": "确认写入文件"
  },
  "m928": {
    "ru": "Предпросмотр инструкций",
    "en": "Instruction preview",
    "zh-CN": "指令预览"
  },
  "m929": {
    "ru": "Показать",
    "en": "Show",
    "zh-CN": "显示"
  },
  "m930": {
    "ru": "Этот контекст",
    "en": "This context",
    "zh-CN": "当前上下文"
  },
  "m931": {
    "ru": "Другие проекты",
    "en": "Other projects",
    "zh-CN": "其他项目"
  },
  "m932": {
    "ru": "Все инструкции",
    "en": "All instructions",
    "zh-CN": "所有指令"
  },
  "m933": {
    "ru": "Строим предпросмотр по текущей памяти…",
    "en": "Building preview from current memory…",
    "zh-CN": "正在根据当前记忆生成预览…"
  },
  "m934": {
    "ru": "Личность · единое поле persona",
    "en": "Personality · shared persona field",
    "zh-CN": "个性 · 共享 persona 字段"
  },
  "m935": {
    "ru": "Автоматически собрано из активных глобальных инструкций Notebook. Для изменения откройте запись ниже; механизм записи памяти остаётся прежним.",
    "en": "Automatically assembled from active global Notebook instructions. Open a record below to edit; memory writing stays the same.",
    "zh-CN": "自动由活动全局 Notebook 指令汇总。请打开下方记录编辑；记忆写入机制保持不变。"
  },
  "m936": {
    "ru": "Доступные возможности",
    "en": "Available features",
    "zh-CN": "可用功能"
  },
  "m937": {
    "ru": "Notebook, проекты, инструкции, сохранённые источники и Notes, разделы, чанки, редактор Notes/источников, управление связями, сохранённый граф, пробный поиск и удаление знаний.",
    "en": "Notebook, projects, instructions, saved sources and Notes, sections, chunks, Note/source editor, links, saved graph, trial search and knowledge deletion.",
    "zh-CN": "Notebook、项目、指令、已保存来源和笔记、章节、分块、笔记/来源编辑器、关联管理、已保存图谱、试用搜索及知识删除。"
  },
  "m938": {
    "ru": "Режим хранения, снимки, облачное подключение и параметры поиска доступны в «Настройках». Управление кэшем, загрузкой моделей и переиндексацией — в разделе «Модели». Настройка клиентов доступна через CLI.",
    "en": "Storage mode, snapshots, cloud connection and search options are in Settings. Cache, model loading and reindexing are under Models. Client setup is available through the CLI.",
    "zh-CN": "存储模式、快照、云端连接和搜索选项位于“设置”。缓存、模型加载和重建索引位于“模型”。客户端设置可通过 CLI 完成。"
  },
  "m939": {
    "ru": "Общие для всех проектов и клиентов на этом компьютере.",
    "en": "Shared by all projects and clients on this computer.",
    "zh-CN": "适用于本机所有项目和客户端。"
  },
  "m940": {
    "ru": "Хранение и облачные снимки",
    "en": "Storage and cloud snapshots",
    "zh-CN": "存储和云端快照"
  },
  "m941": {
    "ru": "Рабочая память хранится локально. Облако содержит полные ZIP-снимки; чтение и редактирование памяти не требуют сети.",
    "en": "Working memory is local. Cloud stores full ZIP snapshots; reading and editing memory need no network.",
    "zh-CN": "工作记忆保存在本地。云端存储完整 ZIP 快照；读取和编辑记忆无需联网。"
  },
  "m942": {
    "ru": "Режим хранения",
    "en": "Storage mode",
    "zh-CN": "存储模式"
  },
  "m943": {
    "ru": "Только локально",
    "en": "Local only",
    "zh-CN": "仅本地"
  },
  "m944": {
    "ru": "Локально + облачные снимки",
    "en": "Local + cloud snapshots",
    "zh-CN": "本地 + 云端快照"
  },
  "m945": {
    "ru": "Включение снимков сохраняет резервную копию. Для прежних облачных режимов выполняется проверка и резервирование обеих копий.",
    "en": "Enabling snapshots creates a backup. Legacy cloud modes require checking and backing up both copies.",
    "zh-CN": "启用快照会创建备份。旧云端模式会检查并备份两个副本。"
  },
  "m946": {
    "ru": "Применить режим",
    "en": "Apply mode",
    "zh-CN": "应用模式"
  },
  "m947": {
    "ru": "Расписание снимков",
    "en": "Snapshot schedule",
    "zh-CN": "快照计划"
  },
  "m948": {
    "ru": "Отправка в облако",
    "en": "Cloud upload",
    "zh-CN": "云端上传"
  },
  "m949": {
    "ru": "Вручную",
    "en": "Manual",
    "zh-CN": "手动"
  },
  "m950": {
    "ru": "По расписанию",
    "en": "Scheduled",
    "zh-CN": "按计划"
  },
  "m951": {
    "ru": "Положительное число: 0.5, 24, 168. Расписание выполняется, пока работает панель или клиент памяти.",
    "en": "Positive number: 0.5, 24, 168. Scheduling runs while the dashboard or a memory client is running.",
    "zh-CN": "正数，例如 0.5、24、168。面板或记忆客户端运行时执行计划。"
  },
  "m952": {
    "ru": "Сохранить расписание",
    "en": "Save schedule",
    "zh-CN": "保存计划"
  },
  "m953": {
    "ru": "Подключение к облаку",
    "en": "Cloud connection",
    "zh-CN": "云端连接"
  },
  "m954": {
    "ru": "URL базы Turso",
    "en": "Turso database URL",
    "zh-CN": "Turso 数据库 URL"
  },
  "m955": {
    "ru": "Токен базы",
    "en": "Database token",
    "zh-CN": "数据库令牌"
  },
  "m956": {
    "ru": "Сохраняется в существующем зашифрованном хранилище. Проверка подключения запускается отдельно.",
    "en": "Saved in existing encrypted storage. Connection check runs separately.",
    "zh-CN": "保存到现有加密存储。连接检查需单独运行。"
  },
  "m957": {
    "ru": "Сохранить подключение",
    "en": "Save connection",
    "zh-CN": "保存连接"
  },
  "m958": {
    "ru": "Проверить подключение",
    "en": "Check connection",
    "zh-CN": "检查连接"
  },
  "m959": {
    "ru": "Выйти из облака",
    "en": "Sign out of cloud",
    "zh-CN": "退出云端"
  },
  "m960": {
    "ru": "Проверить и сохранить настройки",
    "en": "Review and save settings",
    "zh-CN": "检查并保存设置"
  },
  "m961": {
    "ru": "Отменить правки и обновить",
    "en": "Discard edits and refresh",
    "zh-CN": "丢弃编辑并刷新"
  },
  "m962": {
    "ru": "Снимки и восстановление",
    "en": "Snapshots and recovery",
    "zh-CN": "快照和恢复"
  },
  "m963": {
    "ru": "Создать локальный снимок",
    "en": "Create local snapshot",
    "zh-CN": "创建本地快照"
  },
  "m964": {
    "ru": "Отправить текущую память",
    "en": "Upload current memory",
    "zh-CN": "上传当前记忆"
  },
  "m965": {
    "ru": "Список снимков",
    "en": "Snapshot list",
    "zh-CN": "快照列表"
  },
  "m966": {
    "ru": "Загрузить список",
    "en": "Load list",
    "zh-CN": "加载列表"
  },
  "m967": {
    "ru": "Удалить старые снимки",
    "en": "Delete old snapshots",
    "zh-CN": "删除旧快照"
  },
  "m968": {
    "ru": "С даты, включительно",
    "en": "From date, inclusive",
    "zh-CN": "起始日期（含）"
  },
  "m969": {
    "ru": "До даты, не включительно",
    "en": "Until date, exclusive",
    "zh-CN": "截止日期（不含）"
  },
  "m970": {
    "ru": "Расположение",
    "en": "Location",
    "zh-CN": "位置"
  },
  "m971": {
    "ru": "В обоих местах",
    "en": "Both locations",
    "zh-CN": "两个位置"
  },
  "m972": {
    "ru": "Границы периода — 00:00 UTC. Последние, ожидающие и закреплённые снимки защищены.",
    "en": "Period boundaries are 00:00 UTC. Latest, pending and pinned snapshots are protected.",
    "zh-CN": "时间边界为 00:00 UTC。最新、待处理和已固定快照受保护。"
  },
  "m973": {
    "ru": "Предпросмотр удаления",
    "en": "Preview deletion",
    "zh-CN": "预览删除"
  },
  "m974": {
    "ru": "Применить",
    "en": "Apply",
    "zh-CN": "应用"
  },
  "m975": {
    "ru": "Несохранённые настройки",
    "en": "Unsaved settings",
    "zh-CN": "未保存的设置"
  },
  "m976": {
    "ru": "Правки останутся в форме, если продолжить редактирование.",
    "en": "Edits stay in the form if you keep editing.",
    "zh-CN": "继续编辑会保留表单中的更改。"
  },
  "m977": {
    "ru": "Отменить правки",
    "en": "Discard edits",
    "zh-CN": "丢弃编辑"
  },
  "m978": {
    "ru": "Продолжить редактирование",
    "en": "Keep editing",
    "zh-CN": "继续编辑"
  },
  "m979": {
    "ru": "Embedding и reranker для поиска и индексации. Выбор модели, размерности, таймера выгрузки и параметров вычислений — в «Настройках».",
    "en": "Embedding and reranker for search and indexing. Model, dimensions, unload timer and compute settings are in Settings.",
    "zh-CN": "用于搜索和索引的嵌入模型与重排器。模型、维度、卸载计时和计算参数位于“设置”。"
  },
  "m980": {
    "ru": "Обновить состояние моделей",
    "en": "Refresh model status",
    "zh-CN": "刷新模型状态"
  },
  "m981": {
    "ru": "Параметры моделей",
    "en": "Model settings",
    "zh-CN": "模型设置"
  },
  "m982": {
    "ru": "RAM и память GPU",
    "en": "RAM and GPU memory",
    "zh-CN": "RAM 和 GPU 内存"
  },
  "m983": {
    "ru": "RAM процессов плагина",
    "en": "Plugin process RAM",
    "zh-CN": "插件进程 RAM"
  },
  "m984": {
    "ru": "Память всего процесса (RSS), включая модели и служебные данные. Учтены панель и зарегистрированные клиенты; общие страницы могут пересекаться, поэтому значения не суммируются.",
    "en": "Whole-process memory (RSS), including models and service data. Covers dashboard and registered clients; shared pages can overlap, so values are not summed.",
    "zh-CN": "整个进程内存（RSS），包括模型和服务数据。统计面板和已注册客户端；共享页可能重叠，因此不合计。"
  },
  "m985": {
    "ru": "Выбранные модели",
    "en": "Selected models",
    "zh-CN": "所选模型"
  },
  "m986": {
    "ru": "Загрузка в память клиента",
    "en": "Client memory loading",
    "zh-CN": "加载到客户端内存"
  },
  "m987": {
    "ru": "Показаны зарегистрированные процессы. Состояние остальных процессов неизвестно. CPU использует RAM; GPU на Windows — DirectML. Команды требуют подтверждения выбранного клиента.",
    "en": "Registered processes are shown. Other process state is unknown. CPU uses RAM; Windows GPU uses DirectML. Commands require confirmation from the selected client.",
    "zh-CN": "显示已注册进程。其他进程状态未知。CPU 使用 RAM；Windows GPU 使用 DirectML。命令需要所选客户端确认。"
  },
  "m988": {
    "ru": "Процесс клиента",
    "en": "Client process",
    "zh-CN": "客户端进程"
  },
  "m989": {
    "ru": "Устройство загрузки",
    "en": "Load device",
    "zh-CN": "加载设备"
  },
  "m990": {
    "ru": "Загрузить в память",
    "en": "Load into memory",
    "zh-CN": "加载到内存"
  },
  "m991": {
    "ru": "Выгрузить из памяти",
    "en": "Unload from memory",
    "zh-CN": "从内存卸载"
  },
  "m992": {
    "ru": "Применить устройство",
    "en": "Apply device",
    "zh-CN": "应用设备"
  },
  "m993": {
    "ru": "Кэш на диске",
    "en": "Disk cache",
    "zh-CN": "磁盘缓存"
  },
  "m994": {
    "ru": "Скачивание проверяет выбранную модель на CPU и затем освобождает память процесса загрузки. Оно не меняет выбор модели для поиска.",
    "en": "Download validates the model on CPU, then releases the download process memory. It does not change the search model selection.",
    "zh-CN": "下载会在 CPU 验证模型，然后释放下载进程内存。不改变搜索模型选择。"
  },
  "m995": {
    "ru": "Тип модели",
    "en": "Model type",
    "zh-CN": "模型类型"
  },
  "m996": {
    "ru": "ID модели Hugging Face",
    "en": "Hugging Face model ID",
    "zh-CN": "Hugging Face 模型 ID"
  },
  "m997": {
    "ru": "Скачать и проверить модель",
    "en": "Download and validate model",
    "zh-CN": "下载并验证模型"
  },
  "m998": {
    "ru": "«Файлы на месте» означает наличие config, tokenizer и весов; исправность подтверждает только загрузка модели. Для очистки кэша закройте клиенты памяти.",
    "en": "Files present means config, tokenizer and weights exist; only loading confirms the model works. Close memory clients before clearing cache.",
    "zh-CN": "“文件已就绪”表示 config、tokenizer 和权重存在；只有加载才能确认模型正常。清理缓存前请关闭记忆客户端。"
  },
  "m999": {
    "ru": "Переиндексация знаний",
    "en": "Knowledge reindexing",
    "zh-CN": "重建知识索引"
  },
  "m1000": {
    "ru": "Перестроить векторы всех локальных источников и Notes выбранной embedding-моделью. Новые векторы публикуются вместе после подготовки; Notebook остаётся доступен.",
    "en": "Rebuild vectors for all local sources and Notes with the selected embedding model. New vectors are published together after preparation; Notebook stays available.",
    "zh-CN": "使用所选嵌入模型重建所有本地来源和笔记的向量。准备后统一发布新向量；Notebook 仍可使用。"
  },
  "m1001": {
    "ru": "Предпросмотр переиндексации",
    "en": "Preview reindexing",
    "zh-CN": "预览重建索引"
  },
  "m1002": {
    "ru": "Последняя операция",
    "en": "Latest operation",
    "zh-CN": "最近操作"
  },
  "m1003": {
    "ru": "Прогресс операции моделей",
    "en": "Model operation progress",
    "zh-CN": "模型操作进度"
  },
  "m1004": {
    "ru": "Проверить операцию с моделями",
    "en": "Review model operation",
    "zh-CN": "检查模型操作"
  },
  "m1005": {
    "ru": "Выполнить",
    "en": "Run",
    "zh-CN": "执行"
  },
  "m1006": {
    "ru": "Пробный поиск знаний",
    "en": "Trial knowledge search",
    "zh-CN": "知识搜索试用"
  },
  "m1007": {
    "ru": "Закрыть поиск",
    "en": "Close search",
    "zh-CN": "关闭搜索"
  },
  "m1008": {
    "ru": "Контекст — выбранная область; глобальные источники добавляются переключателем в списке знаний. Результат поиска не доказывает передачу или фактическое использование памяти агентом.",
    "en": "Context is the selected scope; include global sources using the knowledge list toggle. Search results do not prove memory delivery or actual agent usage.",
    "zh-CN": "上下文为所选范围；可通过知识列表开关包含全局来源。搜索结果不能证明记忆已传递或被代理实际使用。"
  },
  "m1009": {
    "ru": "Запрос",
    "en": "Query",
    "zh-CN": "查询"
  },
  "m1010": {
    "ru": "Способ поиска",
    "en": "Search method",
    "zh-CN": "搜索方式"
  },
  "m1011": {
    "ru": "Текстовый индекс (без моделей)",
    "en": "Text index (no models)",
    "zh-CN": "文本索引（无需模型）"
  },
  "m1012": {
    "ru": "Dense (локальная модель)",
    "en": "Dense (local model)",
    "zh-CN": "稠密搜索（本地模型）"
  },
  "m1013": {
    "ru": "Результат",
    "en": "Result",
    "zh-CN": "结果"
  },
  "m1014": {
    "ru": "Фрагменты",
    "en": "Snippets",
    "zh-CN": "片段"
  },
  "m1015": {
    "ru": "Индекс источников",
    "en": "Source index",
    "zh-CN": "来源索引"
  },
  "m1016": {
    "ru": "Разворачивать таблицы и код во фрагментах",
    "en": "Expand tables and code in snippets",
    "zh-CN": "在片段中展开表格和代码"
  },
  "m1017": {
    "ru": "Выполнить пробный поиск",
    "en": "Run trial search",
    "zh-CN": "运行试用搜索"
  },
  "m1018": {
    "ru": "Сохранённый граф знаний",
    "en": "Saved knowledge graph",
    "zh-CN": "已保存的知识图谱"
  },
  "m1019": {
    "ru": "Закрыть граф",
    "en": "Close graph",
    "zh-CN": "关闭图谱"
  },
  "m1020": {
    "ru": "Документ (до 100 в списке)",
    "en": "Document (up to 100 listed)",
    "zh-CN": "文档（最多列出 100 个）"
  },
  "m1021": {
    "ru": "Вид узла",
    "en": "Node type",
    "zh-CN": "节点类型"
  },
  "m1022": {
    "ru": "Все узлы",
    "en": "All nodes",
    "zh-CN": "所有节点"
  },
  "m1023": {
    "ru": "Notebook-факты",
    "en": "Notebook facts",
    "zh-CN": "Notebook 事实"
  },
  "m1024": {
    "ru": "Символы",
    "en": "Symbols",
    "zh-CN": "符号"
  },
  "m1025": {
    "ru": "Строки",
    "en": "Lines",
    "zh-CN": "行"
  },
  "m1026": {
    "ru": "Точное отношение",
    "en": "Exact relation",
    "zh-CN": "精确关系"
  },
  "m1027": {
    "ru": "Например, CONTAINS",
    "en": "For example, CONTAINS",
    "zh-CN": "例如 CONTAINS"
  },
  "m1028": {
    "ru": "Применить фильтры",
    "en": "Apply filters",
    "zh-CN": "应用筛选"
  },
  "m1029": {
    "ru": "Символы адресуются только по имени и могут иметь разные определения. Неопределённые и недоступные концы рёбер не показаны. Структурные рёбра перестраиваются из источника; ручные связи изменяются отдельно.",
    "en": "Symbols are addressed by name only and may have different definitions. Unresolved or inaccessible edge endpoints are hidden. Structural edges rebuild from sources; manual links are edited separately.",
    "zh-CN": "符号仅按名称寻址，可能有不同定义。未解析或不可访问的边端点不显示。结构边从来源重建；手动关联单独编辑。"
  },
  "m1030": {
    "ru": "Предыдущие рёбра",
    "en": "Previous edges",
    "zh-CN": "上一组边"
  },
  "m1031": {
    "ru": "Следующие рёбра",
    "en": "Next edges",
    "zh-CN": "下一组边"
  },
  "m1032": {
    "ru": "Удаление знаний",
    "en": "Delete knowledge",
    "zh-CN": "删除知识"
  },
  "m1033": {
    "ru": "Прежние снимки сохраняют историю. Удалённые данные могут вернуться только при явном восстановлении снимка.",
    "en": "Previous snapshots retain history. Deleted data can return only through explicit snapshot recovery.",
    "zh-CN": "旧快照保留历史。仅明确恢复快照时才会恢复已删除数据。"
  },
  "m1034": {
    "ru": "Подтверждаю действие и проверенные последствия",
    "en": "I confirm this action and reviewed consequences",
    "zh-CN": "确认此操作及已检查的影响"
  },
  "m1035": {
    "ru": "Подтверждаю удаление во всех областях документа",
    "en": "I confirm deletion across all document scopes",
    "zh-CN": "确认删除文档所有范围中的内容"
  },
  "m1036": {
    "ru": "Применить удаление",
    "en": "Apply deletion",
    "zh-CN": "执行删除"
  },
  "m1037": {
    "ru": "Редактор знаний",
    "en": "Knowledge editor",
    "zh-CN": "知识编辑器"
  },
  "m1038": {
    "ru": "Подготовить хранилище",
    "en": "Prepare storage",
    "zh-CN": "准备存储"
  },
  "m1039": {
    "ru": "Содержимое и параметры индекса",
    "en": "Content and index settings",
    "zh-CN": "内容和索引设置"
  },
  "m1040": {
    "ru": "Тип источника",
    "en": "Source type",
    "zh-CN": "来源类型"
  },
  "m1041": {
    "ru": "Текст",
    "en": "Text",
    "zh-CN": "正文"
  },
  "m1042": {
    "ru": "Локальный файл",
    "en": "Local file",
    "zh-CN": "本地文件"
  },
  "m1043": {
    "ru": "Путь файла или URL",
    "en": "File path or URL",
    "zh-CN": "文件路径或 URL"
  },
  "m1044": {
    "ru": "Файлы читаются только из разрешённых каталогов; URL проверяется перед загрузкой.",
    "en": "Files are read only from allowed directories; URLs are validated before fetching.",
    "zh-CN": "仅从允许的目录读取文件；获取前会验证 URL。"
  },
  "m1045": {
    "ru": "Текст Markdown",
    "en": "Markdown text",
    "zh-CN": "Markdown 正文"
  },
  "m1046": {
    "ru": "Редактор принимает до 2 MiB текста. Для файла или URL текст готовится при явном обновлении.",
    "en": "Editor accepts up to 2 MiB of text. File or URL content is prepared on explicit refresh.",
    "zh-CN": "编辑器接受最多 2 MiB 正文。文件或 URL 内容仅在明确刷新时准备。"
  },
  "m1047": {
    "ru": "Решение",
    "en": "Decision",
    "zh-CN": "决定"
  },
  "m1048": {
    "ru": "Исследование",
    "en": "Research",
    "zh-CN": "研究"
  },
  "m1049": {
    "ru": "Контекст",
    "en": "Context",
    "zh-CN": "上下文"
  },
  "m1050": {
    "ru": "Передача работы",
    "en": "Handoff",
    "zh-CN": "工作交接"
  },
  "m1051": {
    "ru": "Теги через запятую",
    "en": "Comma-separated tags",
    "zh-CN": "用逗号分隔的标签"
  },
  "m1052": {
    "ru": "Индекс при перестроении",
    "en": "Rebuild index",
    "zh-CN": "重建时的索引"
  },
  "m1053": {
    "ru": "Текстовый поиск без векторов",
    "en": "Text search without vectors",
    "zh-CN": "无向量文本搜索"
  },
  "m1054": {
    "ru": "Текстовый поиск и embeddings",
    "en": "Text search and embeddings",
    "zh-CN": "文本搜索和嵌入向量"
  },
  "m1055": {
    "ru": "Embeddings запускают модель. При ошибке сохранённая ревизия остаётся прежней; текстовый вариант удаляет старые векторы. Только изменение тегов или вида Note сохраняет индекс.",
    "en": "Embeddings run a model. On failure, the saved revision remains unchanged; text-only removes old vectors. Editing only tags or Note kind preserves the index.",
    "zh-CN": "嵌入向量会运行模型。失败时已保存修订不变；纯文本模式会移除旧向量。仅更改标签或笔记类型会保留索引。"
  },
  "m1056": {
    "ru": "Подготовить и проверить",
    "en": "Prepare and review",
    "zh-CN": "准备并检查"
  },
  "m1057": {
    "ru": "Обновить версию",
    "en": "Refresh version",
    "zh-CN": "刷新版本"
  },
  "m1058": {
    "ru": "Отбросить подготовку",
    "en": "Discard preparation",
    "zh-CN": "丢弃准备"
  },
  "m1059": {
    "ru": "Текущий сохранённый текст для сравнения с черновиком",
    "en": "Current saved text to compare with draft",
    "zh-CN": "用于与草稿比较的当前已保存正文"
  },
  "m1060": {
    "ru": "Предпросмотр публикации",
    "en": "Publication preview",
    "zh-CN": "发布预览"
  },
  "m1061": {
    "ru": "Подтверждаю обновление документа во всех его областях",
    "en": "I confirm updating this document in all its scopes",
    "zh-CN": "确认更新文档的所有范围"
  },
  "m1062": {
    "ru": "Опубликовать ревизию",
    "en": "Publish revision",
    "zh-CN": "发布修订"
  },
  "m1063": {
    "ru": "Подготовить хранилище знаний",
    "en": "Prepare knowledge storage",
    "zh-CN": "准备知识存储"
  },
  "m1064": {
    "ru": "Операция создаст и проверит полный локальный ZIP всех проектов, назначит недостающие ID фактам и сохранит отчёт о неоднозначных связях. Облако не используется.",
    "en": "Creates and verifies a full local ZIP of all projects, assigns missing fact IDs and saves an ambiguous-link report. No cloud used.",
    "zh-CN": "创建并验证所有项目的完整本地 ZIP，分配缺失事实 ID 并保存不明确关联报告。不使用云端。"
  },
  "m1065": {
    "ru": "Подготовка не завершена. Проверьте локальное хранилище и резервную копию.",
    "en": "Preparation incomplete. Check local storage and backup.",
    "zh-CN": "准备未完成。请检查本地存储和备份。"
  },
  "m1066": {
    "ru": "Создать копию и подготовить",
    "en": "Back up and prepare",
    "zh-CN": "备份并准备"
  },
  "m1067": {
    "ru": "Подготовить связи",
    "en": "Prepare links",
    "zh-CN": "准备关联"
  },
  "m1068": {
    "ru": "Факт Notebook",
    "en": "Notebook fact",
    "zh-CN": "Notebook 事实"
  },
  "m1069": {
    "ru": "Поиск источников",
    "en": "Search sources",
    "zh-CN": "搜索来源"
  },
  "m1070": {
    "ru": "Найти источники",
    "en": "Find sources",
    "zh-CN": "查找来源"
  },
  "m1071": {
    "ru": "Источник или Note",
    "en": "Source or Note",
    "zh-CN": "来源或笔记"
  },
  "m1072": {
    "ru": "Отношение",
    "en": "Relation",
    "zh-CN": "关系"
  },
  "m1073": {
    "ru": "ID раздела (необязательно)",
    "en": "Section ID (optional)",
    "zh-CN": "章节 ID（可选）"
  },
  "m1074": {
    "ru": "Начальная строка",
    "en": "Start line",
    "zh-CN": "起始行"
  },
  "m1075": {
    "ru": "Конечная строка",
    "en": "End line",
    "zh-CN": "结束行"
  },
  "m1076": {
    "ru": "Строки относятся к сохранённому нормализованному тексту. Перед подтверждением проверьте выбранный фрагмент.",
    "en": "Lines refer to saved normalized text. Check the selected fragment before confirming.",
    "zh-CN": "行号对应已保存的规范化正文。确认前请检查所选片段。"
  },
  "m1077": {
    "ru": "Проверка действия",
    "en": "Review action",
    "zh-CN": "检查操作"
  },
  "m1078": {
    "ru": "Подготовить устойчивые связи?",
    "en": "Prepare stable links?",
    "zh-CN": "准备稳定关联？"
  },
  "m1079": {
    "ru": "Будет сохранён полный локальный ZIP-снимок. Факты без ID получат идентификаторы; однозначные связи сохранят принадлежность. Неоднозначные связи останутся в состоянии needs_review.",
    "en": "A full local ZIP snapshot will be saved. Facts without IDs get identifiers; unambiguous links retain ownership. Ambiguous links remain needs_review.",
    "zh-CN": "将保存完整本地 ZIP 快照。无 ID 的事实会分配标识符；明确关联保留归属。不明确关联保持 needs_review。"
  },
  "m1080": {
    "ru": "Подготовка касается всей локальной памяти. Старые координаты не становятся подтверждёнными автоматически.",
    "en": "Preparation affects all local memory. Old coordinates are not automatically confirmed.",
    "zh-CN": "准备影响所有本地记忆。旧坐标不会自动确认。"
  },
  "m1081": {
    "ru": "Сохранить снимок и подготовить",
    "en": "Save snapshot and prepare",
    "zh-CN": "保存快照并准备"
  },
  "m1082": {
    "ru": "Область и разделы",
    "en": "Scope and sections",
    "zh-CN": "范围和分区"
  },
  "m1083": {
    "ru": "Алгоритм поиска",
    "en": "Search algorithm",
    "zh-CN": "搜索算法"
  },
  "m1084": {
    "ru": "Объединение текстового и векторного поиска.",
    "en": "Combines text and vector search.",
    "zh-CN": "合并文本和向量搜索。"
  },
  "m1085": {
    "ru": "Векторный",
    "en": "Vector",
    "zh-CN": "向量"
  },
  "m1086": {
    "ru": "Текстовый",
    "en": "Text",
    "zh-CN": "文本"
  },
  "m1087": {
    "ru": "Вес векторного поиска",
    "en": "Vector search weight",
    "zh-CN": "向量搜索权重"
  },
  "m1088": {
    "ru": "Для RSF: от 0 до 1.",
    "en": "For RSF: 0 to 1.",
    "zh-CN": "用于 RSF：0 至 1。"
  },
  "m1089": {
    "ru": "Раскрывать таблицы и код",
    "en": "Expand tables and code",
    "zh-CN": "展开表格和代码"
  },
  "m1090": {
    "ru": "Добавлять контекст родительской таблицы или кода к найденному фрагменту.",
    "en": "Add parent table or code context to a matching fragment.",
    "zh-CN": "为匹配片段添加父表格或代码上下文。"
  },
  "m1091": {
    "ru": "Лимит векторных кандидатов",
    "en": "Vector candidate limit",
    "zh-CN": "向量候选项上限"
  },
  "m1092": {
    "ru": "0 — без ограничения.",
    "en": "0 means unlimited.",
    "zh-CN": "0 表示无限制。"
  },
  "m1093": {
    "ru": "Embedding-модель",
    "en": "Embedding model",
    "zh-CN": "嵌入模型"
  },
  "m1094": {
    "ru": "ID модели Hugging Face. Смена требует переиндексации; сохранение не скачивает модель.",
    "en": "Hugging Face model ID. Changing requires reindexing; saving does not download the model.",
    "zh-CN": "Hugging Face 模型 ID。更改后需要重建索引；保存不会下载模型。"
  },
  "m1095": {
    "ru": "Размерность векторов",
    "en": "Vector dimensions",
    "zh-CN": "向量维度"
  },
  "m1096": {
    "ru": "0 — определять по модели. Смена требует переиндексации.",
    "en": "0 uses model dimensions. Changing requires reindexing.",
    "zh-CN": "0 表示由模型决定。更改后需要重建索引。"
  },
  "m1097": {
    "ru": "Reranker-модель",
    "en": "Reranker model",
    "zh-CN": "重排模型"
  },
  "m1098": {
    "ru": "ID cross-encoder модели или none.",
    "en": "Cross-encoder model ID or none.",
    "zh-CN": "Cross-encoder 模型 ID 或 none。"
  },
  "m1099": {
    "ru": "Включить reranker",
    "en": "Enable reranker",
    "zh-CN": "启用重排器"
  },
  "m1100": {
    "ru": "Пересчитывать оценки первых результатов.",
    "en": "Rescore the top results.",
    "zh-CN": "重新计算前几项结果的评分。"
  },
  "m1101": {
    "ru": "Результатов для reranker",
    "en": "Reranker result count",
    "zh-CN": "重排结果数"
  },
  "m1102": {
    "ru": "От 1 до 100.",
    "en": "From 1 to 100.",
    "zh-CN": "1 至 100。"
  },
  "m1103": {
    "ru": "Размер batch",
    "en": "Batch size",
    "zh-CN": "批大小"
  },
  "m1104": {
    "ru": "Количество чанков за один проход модели.",
    "en": "Chunks per model pass.",
    "zh-CN": "模型每次处理的分块数。"
  },
  "m1105": {
    "ru": "GPU / WebGPU — экспериментальный режим.",
    "en": "GPU / WebGPU is experimental.",
    "zh-CN": "GPU / WebGPU 为实验性功能。"
  },
  "m1106": {
    "ru": "Потоки CPU",
    "en": "CPU threads",
    "zh-CN": "CPU 线程"
  },
  "m1107": {
    "ru": "0 — автоматически.",
    "en": "0 means automatic.",
    "zh-CN": "0 表示自动。"
  },
  "m1108": {
    "ru": "Бюджет обработки batch на GPU.",
    "en": "GPU batch processing budget.",
    "zh-CN": "GPU 批处理预算。"
  },
  "m1109": {
    "ru": "Выгрузка при простое, минут",
    "en": "Idle unload, minutes",
    "zh-CN": "空闲卸载（分钟）"
  },
  "m1110": {
    "ru": "0 — не выгружать. До 1440 минут, как в CLI. Применяется владельцем модели.",
    "en": "0 disables unloading. Up to 1,440 minutes, as in CLI. Applied by the model owner.",
    "zh-CN": "0 表示不卸载。与 CLI 一致，最多 1,440 分钟。由模型所属进程应用。"
  },
  "m1111": {
    "ru": "Порт панели",
    "en": "Dashboard port",
    "zh-CN": "面板端口"
  },
  "m1112": {
    "ru": "0 — автоматически. Новый порт применяется после перезапуска панели.",
    "en": "0 selects automatically. New port applies after restarting the dashboard.",
    "zh-CN": "0 表示自动选择。新端口在重启面板后生效。"
  },
  "m1113": {
    "ru": "Автозапуск панели",
    "en": "Dashboard autostart",
    "zh-CN": "面板自动启动"
  },
  "m1114": {
    "ru": "При запуске клиента; на Windows также при входе пользователя. Выключение оставляет текущую панель открытой.",
    "en": "On client launch; on Windows also at login. Disabling leaves the current panel open.",
    "zh-CN": "客户端启动时运行；Windows 还会在登录时运行。停用不会关闭当前面板。"
  },
  "m1115": {
    "ru": "Дополнительные каталоги источников",
    "en": "Additional source directories",
    "zh-CN": "其他来源目录"
  },
  "m1116": {
    "ru": "По одному абсолютному пути в строке.",
    "en": "One absolute path per line.",
    "zh-CN": "每行一个绝对路径。"
  },
  "m1117": {
    "ru": "Разрешить источники из любых каталогов",
    "en": "Allow sources from any directory",
    "zh-CN": "允许任意目录的来源"
  },
  "m1118": {
    "ru": "Расширяет доступ к файлам за пределы проекта и указанных каталогов.",
    "en": "Extends file access beyond the project and listed directories.",
    "zh-CN": "允许访问项目和所列目录以外的文件。"
  },
  "m1119": {
    "ru": "Неизвестное поле запроса.",
    "en": "Unknown request field.",
    "zh-CN": "未知请求字段。"
  },
  "m1120": {
    "ru": "Настройки изменились в другом клиенте. Обновите значения перед сохранением.",
    "en": "Settings changed in another client. Refresh values before saving.",
    "zh-CN": "其他客户端已更改设置。保存前请刷新数值。"
  },
  "m1121": {
    "ru": "Укажите URL базы libsql:// или https:// без токена, пути и параметров.",
    "en": "Enter a libsql:// or https:// database URL without token, path or parameters.",
    "zh-CN": "请输入 libsql:// 或 https:// 数据库 URL，不含令牌、路径或参数。"
  },
  "m1122": {
    "ru": "Последняя отправка завершилась ошибкой. Повторите отправку или проверьте подключение.",
    "en": "Last upload failed. Retry or check the connection.",
    "zh-CN": "上次上传失败。请重试或检查连接。"
  },
  "m1123": {
    "ru": "{0}: недопустимое значение.",
    "en": "{0}: invalid value.",
    "zh-CN": "{0}：无效值。"
  },
  "m1124": {
    "ru": "{0}: укажите число от {1} до {2}.",
    "en": "{0}: enter a number from {1} to {2}.",
    "zh-CN": "{0}：请输入 {1} 至 {2} 之间的数字。"
  },
  "m1125": {
    "ru": "{0}: укажите ID модели вида organization/model.",
    "en": "{0}: enter a model ID in organization/model format.",
    "zh-CN": "{0}：请输入 organization/model 格式的模型 ID。"
  },
  "m1126": {
    "ru": "{0}: нужны абсолютные пути.",
    "en": "{0}: absolute paths required.",
    "zh-CN": "{0}：需要绝对路径。"
  },
  "m1127": {
    "ru": "Выберите reranker-модель перед включением.",
    "en": "Select a reranker model before enabling.",
    "zh-CN": "启用前请选择重排模型。"
  },
  "m1128": {
    "ru": "Доступны only-local и cloud-snapshots.",
    "en": "Available modes: only-local and cloud-snapshots.",
    "zh-CN": "可用模式：only-local 和 cloud-snapshots。"
  },
  "m1129": {
    "ru": "Интервал снимков должен быть положительным числом часов.",
    "en": "Snapshot interval must be a positive number of hours.",
    "zh-CN": "快照间隔必须为正数小时。"
  },
  "m1130": {
    "ru": "Сначала включите облачные снимки.",
    "en": "Enable cloud snapshots first.",
    "zh-CN": "请先启用云端快照。"
  },
  "m1131": {
    "ru": "Введите токен базы.",
    "en": "Enter a database token.",
    "zh-CN": "请输入数据库令牌。"
  },
  "m1132": {
    "ru": "Подключение задано окружением. Измените переменные окружения перед заменой.",
    "en": "Connection set by environment. Change environment variables before replacing it.",
    "zh-CN": "连接由环境设置。替换前请更改环境变量。"
  },
  "m1133": {
    "ru": "Сначала настройте облачное подключение.",
    "en": "Set up a cloud connection first.",
    "zh-CN": "请先设置云端连接。"
  },
  "m1134": {
    "ru": "Не удалось подключиться к облаку. Проверьте URL, токен и сеть.",
    "en": "Could not connect to cloud. Check URL, token and network.",
    "zh-CN": "无法连接云端。请检查 URL、令牌和网络。"
  },
  "m1135": {
    "ru": "Неизвестное действие настроек.",
    "en": "Unknown settings action.",
    "zh-CN": "未知设置操作。"
  },
  "m1136": {
    "ru": "Неизвестное действие снимков.",
    "en": "Unknown snapshot action.",
    "zh-CN": "未知快照操作。"
  },
  "m1137": {
    "ru": "Неизвестное расположение снимка.",
    "en": "Unknown snapshot location.",
    "zh-CN": "未知快照位置。"
  },
  "m1138": {
    "ru": "Неверный ID снимка.",
    "en": "Invalid snapshot ID.",
    "zh-CN": "快照 ID 无效。"
  },
  "m1139": {
    "ru": "Лимит от 1 до 100.",
    "en": "Limit must be 1 to 100.",
    "zh-CN": "上限必须为 1 至 100。"
  },
  "m1140": {
    "ru": "Неверное логическое значение.",
    "en": "Invalid boolean value.",
    "zh-CN": "布尔值无效。"
  },
  "m1141": {
    "ru": "Неверный токен предпросмотра.",
    "en": "Invalid preview token.",
    "zh-CN": "预览令牌无效。"
  },
  "m1142": {
    "ru": "Укажите корректный период удаления.",
    "en": "Enter a valid deletion period.",
    "zh-CN": "请输入有效删除时间段。"
  },
  "m1143": {
    "ru": "Отправка не завершена. Локальный снимок сохранён; проверьте подключение или квоту.",
    "en": "Upload incomplete. Local snapshot retained; check connection or quota.",
    "zh-CN": "上传未完成。本地快照已保留；请检查连接或配额。"
  },
  "m1144": {
    "ru": "Предпросмотр устарел. Подготовьте его повторно.",
    "en": "Preview expired. Prepare it again.",
    "zh-CN": "预览已过期。请重新准备。"
  },
  "m1145": {
    "ru": "Операция со снимком не завершена. Проверьте подключение и доступность снимка.",
    "en": "Snapshot operation incomplete. Check connection and snapshot availability.",
    "zh-CN": "快照操作未完成。请检查连接及快照可用性。"
  },
  "language": {
    "ru": "Язык",
    "en": "Language",
    "zh-CN": "语言"
  },
  "s1": {
    "ru": "Не удалось прочитать запись операции моделей. Сохраните файлы и проверьте локальное хранилище.",
    "en": "Could not read the model operation record. Keep the files and check local storage.",
    "zh-CN": "无法读取模型操作记录。请保留文件并检查本地存储。"
  },
  "s2": {
    "ru": "Неверный ID операции.",
    "en": "Invalid operation ID.",
    "zh-CN": "操作 ID 无效。"
  },
  "s3": {
    "ru": "Операция не найдена.",
    "en": "Operation not found.",
    "zh-CN": "未找到操作。"
  },
  "s4": {
    "ru": "Клиент сообщил об ошибке выполнения команды.",
    "en": "Client reported a command failure.",
    "zh-CN": "客户端报告命令执行失败。"
  },
  "s5": {
    "ru": "Выбранный процесс клиента завершился без подтверждения команды.",
    "en": "Selected client process exited without confirming the command.",
    "zh-CN": "所选客户端进程已退出，未确认命令。"
  },
  "s6": {
    "ru": "Процесс операции завершился без подтверждения результата. Обновите состояние перед повтором.",
    "en": "Operation process exited without confirming the result. Refresh status before retrying.",
    "zh-CN": "操作进程已退出，未确认结果。重试前请刷新状态。"
  },
  "s7": {
    "ru": "Другая операция с моделями ещё выполняется или ожидает подтверждения.",
    "en": "Another model operation is running or awaiting confirmation.",
    "zh-CN": "其他模型操作正在运行或等待确认。"
  },
  "s8": {
    "ru": "Укажите ID модели organization/model.",
    "en": "Enter a model ID in organization/model format.",
    "zh-CN": "请输入 organization/model 格式的模型 ID。"
  },
  "s9": {
    "ru": "Нужен путь одной модели внутри каталога кэша.",
    "en": "A single model path inside the cache directory is required.",
    "zh-CN": "需要缓存目录内单个模型的路径。"
  },
  "s10": {
    "ru": "Удаление кэша через ссылку недоступно.",
    "en": "Deleting cache through a symlink is unsupported.",
    "zh-CN": "不支持通过符号链接删除缓存。"
  },
  "s11": {
    "ru": "В кэше есть ссылка; удаление недоступно.",
    "en": "Cache contains a symlink; deletion unavailable.",
    "zh-CN": "缓存中含有符号链接；无法删除。"
  },
  "s12": {
    "ru": "Перед удалением кэша закройте клиенты памяти: зарегистрированные процессы могут использовать модель.",
    "en": "Close memory clients before deleting cache: registered processes may be using the model.",
    "zh-CN": "删除缓存前请关闭记忆客户端：已注册进程可能正在使用模型。"
  },
  "s13": {
    "ru": "Кэш модели пуст или не найден.",
    "en": "Model cache is empty or missing.",
    "zh-CN": "模型缓存为空或不存在。"
  },
  "s14": {
    "ru": "Предпросмотр проверяется повторно перед удалением.",
    "en": "Preview is checked again before deletion.",
    "zh-CN": "删除前会再次检查预览。"
  },
  "s15": {
    "ru": "Сначала скачайте выбранную embedding-модель.",
    "en": "Download the selected embedding model first.",
    "zh-CN": "请先下载所选嵌入模型。"
  },
  "s16": {
    "ru": "Неизвестная операция предпросмотра.",
    "en": "Unknown preview operation.",
    "zh-CN": "未知预览操作。"
  },
  "s17": {
    "ru": "Настройки моделей изменились. Обновите панель перед запуском.",
    "en": "Model settings changed. Refresh the dashboard before starting.",
    "zh-CN": "模型设置已更改。开始前请刷新面板。"
  },
  "s18": {
    "ru": "Неизвестная операция моделей.",
    "en": "Unknown model operation.",
    "zh-CN": "未知模型操作。"
  },
  "s19": {
    "ru": "Выберите тип модели.",
    "en": "Select a model type.",
    "zh-CN": "请选择模型类型。"
  },
  "s20": {
    "ru": "Нет свежего состояния выбранного процесса клиента.",
    "en": "No fresh status for the selected client process.",
    "zh-CN": "所选客户端进程没有最新状态。"
  },
  "s21": {
    "ru": "Этот клиент использует старый протокол управления моделями. Обновите плагин в клиенте.",
    "en": "This client uses an older model control protocol. Update its plugin.",
    "zh-CN": "此客户端使用旧模型控制协议。请更新其插件。"
  },
  "s22": {
    "ru": "Выберите CPU или GPU.",
    "en": "Select CPU or GPU.",
    "zh-CN": "请选择 CPU 或 GPU。"
  },
  "s23": {
    "ru": "Сначала скачайте модель {0}.",
    "en": "Download model {0} first.",
    "zh-CN": "请先下载模型 {0}。"
  },
  "s24": {
    "ru": "Индекс или настройки изменились после предпросмотра.",
    "en": "Index or settings changed after preview.",
    "zh-CN": "索引或设置在预览后已更改。"
  },
  "s25": {
    "ru": "Не удалось запустить процесс операции.",
    "en": "Could not start the operation process.",
    "zh-CN": "无法启动操作进程。"
  },
  "s26": {
    "ru": "Процесс операции не запущен.",
    "en": "Operation process not started.",
    "zh-CN": "操作进程未启动。"
  },
  "s27": {
    "ru": "Неизвестное поле операции моделей.",
    "en": "Unknown model operation field.",
    "zh-CN": "未知模型操作字段。"
  },
  "s28": {
    "ru": "Настройки моделей изменились.",
    "en": "Model settings changed.",
    "zh-CN": "模型设置已更改。"
  },
  "s29": {
    "ru": "Кэш изменился после предпросмотра. Обновите список.",
    "en": "Cache changed after preview. Refresh the list.",
    "zh-CN": "缓存在预览后已更改。请刷新列表。"
  },
  "s30": {
    "ru": "Удаляются только принадлежащие плагину глобальные регистрации, managed-блоки и неизменённый skill выбранного клиента. Память, модели, облако, npm-пакет, cache, проекты и работающая панель сохраняются. Активная сессия может требовать перезапуска клиента.",
    "en": "Removes only plugin-owned global registrations, managed blocks and the selected client's unchanged skill. Memory, models, cloud, npm package, cache, projects and the running dashboard remain. Active sessions may require restarting the client.",
    "zh-CN": "仅移除插件所属全局注册、受管区块和所选客户端未更改的技能。记忆、模型、云端、npm 包、缓存、项目和正在运行的面板均保留。活动会话可能需要重启客户端。"
  },
  "s31": {
    "ru": "Операция прервана. Проверьте квитанцию и восстановите файлы по свежему предпросмотру.",
    "en": "Operation interrupted. Check the receipt and restore files using a fresh preview.",
    "zh-CN": "操作已中断。请检查回执并通过最新预览恢复文件。"
  },
  "s32": {
    "ru": "Не удалось безопасно прочитать файлы клиента.",
    "en": "Could not safely read client files.",
    "zh-CN": "无法安全读取客户端文件。"
  }
};
