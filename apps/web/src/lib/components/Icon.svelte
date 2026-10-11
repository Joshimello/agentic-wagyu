<script lang="ts">
  import {
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowSquareOut,
    ArrowsOutSimple,
    CaretDown,
    CaretLeft,
    CaretRight,
    CaretUp,
    X,
    DownloadSimple,
    PencilSimple,
    Check,
    Play,
    VideoCamera,
    FileText,
    Image,
    Translate,
    MagnifyingGlass,
    Clock,
    Info,
    Warning,
    ArrowsClockwise,
    DotsThree,
    ClockCounterClockwise,
    FloppyDisk,
    FolderSimple,
    SquaresFour,
    List,
    Books,
    UploadSimple,
    Plus,
    Minus,
    Copy,
    Users,
    Eye,
    SpeakerHigh,
    Pause,
    Question,
    Funnel,
    CheckCircle,
    ChatText,
    Gear,
    Trash,
  } from 'phosphor-svelte';

  let { name, size = 18 }: { name: string; size?: number } = $props();
  const icons = {
    'arrow-left': ArrowLeft,
    'arrow-right': ArrowRight,
    'arrow-up': ArrowUp,
    'chevron-down': CaretDown,
    'chevron-left': CaretLeft,
    'chevron-right': CaretRight,
    'chevron-up': CaretUp,
    expand: ArrowsOutSimple,
    close: X,
    download: DownloadSimple,
    edit: PencilSimple,
    check: Check,
    play: Play,
    video: VideoCamera,
    file: FileText,
    document: FileText,
    image: Image,
    transcript: ChatText,
    translate: Translate,
    search: MagnifyingGlass,
    clock: Clock,
    info: Info,
    warning: Warning,
    refresh: ArrowsClockwise,
    more: DotsThree,
    external: ArrowSquareOut,
    history: ClockCounterClockwise,
    save: FloppyDisk,
    folder: FolderSimple,
    grid: SquaresFour,
    list: List,
    books: Books,
    upload: UploadSimple,
    plus: Plus,
    minus: Minus,
    copy: Copy,
    users: Users,
    eye: Eye,
    audio: SpeakerHigh,
    pause: Pause,
    help: Question,
    filter: Funnel,
    success: CheckCircle,
    settings: Gear,
    trash: Trash,
  };
  let CurrentIcon = $derived(icons[name as keyof typeof icons] ?? FileText);
</script>

<span class="ui-icon" aria-hidden="true"
  ><CurrentIcon {size} weight="bold" /></span
>

<style>
  .ui-icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    vertical-align: -0.15em;
    line-height: 0;
  }
</style>
